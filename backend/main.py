import os
import re
import json
import asyncio
import random
import requests
from typing import Optional, Generator
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from rank_bm25 import BM25Okapi
from sqlalchemy import create_engine, text
from bs4 import BeautifulSoup

# ── Config ─────────────────────────────────────────────────────────────────────
DATABASE_URL = os.getenv("DATABASE_URL")
OLLAMA_URL   = os.getenv("OLLAMA_URL", "http://ollama:11434")
OLLAMA_MODEL = "llama3.2:3b"
CHUNK_WORDS  = 300
TOP_K        = 2
EVAL_QUESTIONS = 5

CONTAINERS = {
    "backend":  "rag-backend",
    "ollama":   "rag-ollama",
    "postgres": "rag-postgres",
}

engine = create_engine(DATABASE_URL)

app = FastAPI(title="RAG Platform API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── DB Schema ──────────────────────────────────────────────────────────────────
def init_db():
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS pages (
                id         SERIAL PRIMARY KEY,
                title      TEXT NOT NULL,
                url        TEXT,
                content    TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS chunks (
                id         SERIAL PRIMARY KEY,
                page_id    INTEGER REFERENCES pages(id) ON DELETE CASCADE,
                position   INTEGER NOT NULL,
                text       TEXT NOT NULL
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS quiz_questions (
                id               SERIAL PRIMARY KEY,
                page_id          INTEGER REFERENCES pages(id) ON DELETE CASCADE,
                question         TEXT NOT NULL,
                expected_answer  TEXT NOT NULL,
                created_at       TIMESTAMP DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS eval_runs (
                id         SERIAL PRIMARY KEY,
                score_avg  FLOAT,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS eval_results (
                id              SERIAL PRIMARY KEY,
                run_id          INTEGER REFERENCES eval_runs(id) ON DELETE CASCADE,
                question_id     INTEGER REFERENCES quiz_questions(id) ON DELETE CASCADE,
                actual_answer   TEXT,
                score           INTEGER,
                human_score     INTEGER,
                created_at      TIMESTAMP DEFAULT NOW()
            )
        """))
        # Migration: add human_score to existing tables if not present
        try:
            conn.execute(text("ALTER TABLE eval_results ADD COLUMN IF NOT EXISTS human_score INTEGER"))
        except:
            pass
        conn.commit()

@app.on_event("startup")
def startup():
    init_db()
    print("DB initialized.")

# ── Helpers ────────────────────────────────────────────────────────────────────
def chunk_text(content: str, chunk_words: int = CHUNK_WORDS) -> list[str]:
    words  = content.split()
    step   = chunk_words // 2
    chunks = []
    for i in range(0, len(words), step):
        chunk = " ".join(words[i : i + chunk_words])
        if chunk:
            chunks.append(chunk)
    return chunks


def fetch_url(url: str) -> tuple[str, str]:
    headers  = {"User-Agent": "RAGPlatform/1.0"}
    response = requests.get(url, headers=headers, timeout=15)
    response.raise_for_status()
    soup     = BeautifulSoup(response.text, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()
    title = soup.title.string if soup.title else url
    text  = soup.get_text(separator=" ", strip=True)
    text  = re.sub(r'\s+', ' ', text).strip()
    return title.strip(), text


def ingest_content(title: str, content: str, url: Optional[str] = None) -> int:
    chunks = chunk_text(content)
    with engine.connect() as conn:
        result = conn.execute(
            text("INSERT INTO pages (title, url, content) VALUES (:title, :url, :content) RETURNING id"),
            {"title": title, "url": url, "content": content}
        )
        page_id = result.fetchone()[0]
        for i, chunk in enumerate(chunks):
            conn.execute(
                text("INSERT INTO chunks (page_id, position, text) VALUES (:page_id, :position, :text)"),
                {"page_id": page_id, "position": i, "text": chunk}
            )
        conn.commit()
    return page_id


def load_chunks() -> list[str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT text FROM chunks ORDER BY page_id, position")
        ).fetchall()
    return [row[0] for row in rows]


def load_chunks_with_page() -> list[dict]:
    """Load chunks with their page_id for eval question generation."""
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT c.id, c.page_id, c.text, p.title FROM chunks c JOIN pages p ON c.page_id = p.id ORDER BY c.page_id, c.position")
        ).fetchall()
    return [{"id": row[0], "page_id": row[1], "text": row[2], "title": row[3]} for row in rows]


def bm25_retrieve(question: str, chunks: list[str]) -> str:
    stop_words = {"what","is","the","a","an","of","in","was","were","how","when",
                  "where","who","why","did","do","does","that","this","which","by",
                  "at","from","with","and","or","to","for","on","are","has","had","have","be"}
    tokenized    = [[w for w in c.lower().split() if w not in stop_words] for c in chunks]
    query_tokens = [w for w in question.lower().split() if w not in stop_words]
    if not query_tokens:
        return chunks[0] if chunks else ""
    bm25        = BM25Okapi(tokenized)
    scores      = bm25.get_scores(query_tokens)
    top_indices = scores.argsort()[::-1][:TOP_K]
    return " ".join(chunks[i] for i in top_indices)


def call_ollama_sync(prompt: str, timeout: int = 120) -> str:
    payload  = {"model": OLLAMA_MODEL, "prompt": prompt, "stream": False}
    response = requests.post(f"{OLLAMA_URL}/api/generate", json=payload, timeout=timeout)
    response.raise_for_status()
    return response.json()["response"].strip()


def stream_ollama(prompt: str) -> Generator[str, None, None]:
    payload = {"model": OLLAMA_MODEL, "prompt": prompt, "stream": True}
    with requests.post(f"{OLLAMA_URL}/api/generate", json=payload, stream=True, timeout=300) as resp:
        resp.raise_for_status()
        for line in resp.iter_lines():
            if line:
                data  = json.loads(line)
                token = data.get("response", "")
                if token:
                    yield f"data: {json.dumps({'type': 'token', 'text': token})}\n\n"
                if data.get("done"):
                    break


def rewrite_query(question: str) -> str:
    prompt = f"""Rewrite the following question to be clear and grammatically correct. Fix any typos.
Return only the rewritten question, nothing else.

Question: {question}"""
    try:
        return call_ollama_sync(prompt, timeout=60)
    except:
        return question


# ── Schemas ────────────────────────────────────────────────────────────────────
class IngestURLRequest(BaseModel):
    url: str

class IngestTextRequest(BaseModel):
    title: str
    text:  str

class AskRequest(BaseModel):
    question: str

# ── Endpoints ──────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        pg = "up"
    except:
        pg = "down"
    try:
        res    = requests.get(f"{OLLAMA_URL}/api/tags", timeout=3)
        ollama = "up" if res.status_code == 200 else "down"
    except:
        ollama = "down"
    return {
        "status":   "ok" if pg == "up" and ollama == "up" else "degraded",
        "postgres": pg,
        "ollama":   ollama,
    }


@app.post("/ingest/url")
def ingest_url(req: IngestURLRequest):
    try:
        title, content = fetch_url(req.url)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch URL: {e}")
    page_id = ingest_content(title, content, url=req.url)
    chunks  = chunk_text(content)
    return {"page_id": page_id, "title": title, "chunks": len(chunks)}


@app.post("/ingest/text")
def ingest_text(req: IngestTextRequest):
    page_id = ingest_content(req.title, req.text)
    chunks  = chunk_text(req.text)
    return {"page_id": page_id, "title": req.title, "chunks": len(chunks)}


@app.get("/pages")
def list_pages():
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT id, title, url, created_at FROM pages ORDER BY created_at DESC")
        ).fetchall()
    return [{"id": r[0], "title": r[1], "url": r[2], "created_at": str(r[3])} for r in rows]


@app.get("/pages/{page_id}/chunks")
def get_chunks(page_id: int):
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT position, text FROM chunks WHERE page_id = :id ORDER BY position"),
            {"id": page_id}
        ).fetchall()
    return [{"position": row[0], "text": row[1]} for row in rows]


@app.get("/pages/{page_id}")
def get_page(page_id: int):
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT id, title, url, content, created_at FROM pages WHERE id = :id"),
            {"id": page_id}
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Page not found")
    return {"id": row[0], "title": row[1], "url": row[2], "content": row[3], "created_at": str(row[4])}


@app.delete("/pages/{page_id}")
def delete_page(page_id: int):
    with engine.connect() as conn:
        result = conn.execute(
            text("DELETE FROM pages WHERE id = :id RETURNING id"),
            {"id": page_id}
        )
        if not result.fetchone():
            raise HTTPException(status_code=404, detail="Page not found")
        conn.commit()
    return {"deleted": page_id}


@app.post("/ask")
def ask(req: AskRequest):
    def generate():
        yield f"data: {json.dumps({'type': 'status', 'text': 'Rewriting query...'})}\n\n"
        clean_question = rewrite_query(req.question)
        yield f"data: {json.dumps({'type': 'rewritten', 'text': clean_question})}\n\n"

        yield f"data: {json.dumps({'type': 'status', 'text': 'Searching knowledge base...'})}\n\n"
        chunks = load_chunks()
        if not chunks:
            yield f"data: {json.dumps({'type': 'token', 'text': 'No knowledge base yet. Ingest some pages first.'})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
            return
        context = bm25_retrieve(clean_question, chunks)

        yield f"data: {json.dumps({'type': 'status', 'text': 'Answering...'})}\n\n"
        prompt = f"""You are a helpful assistant. Answer the question using ONLY the context below.
If the answer is not in the context, say "I don't have information about that."
Keep your answer concise — 1 to 3 sentences maximum.

Context:
{context}

Question: {clean_question}

Answer:"""
        yield from stream_ollama(prompt)
        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


# ── Eval endpoints ─────────────────────────────────────────────────────────────

@app.get("/eval/questions")
def list_questions():
    with engine.connect() as conn:
        rows = conn.execute(
            text("""
                SELECT q.id, q.question, q.expected_answer, q.created_at, p.title
                FROM quiz_questions q
                JOIN pages p ON q.page_id = p.id
                ORDER BY q.created_at DESC
            """)
        ).fetchall()
    return [{"id": r[0], "question": r[1], "expected_answer": r[2], "created_at": str(r[3]), "page_title": r[4]} for r in rows]


@app.get("/eval/runs")
def list_runs():
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT id, score_avg, created_at FROM eval_runs ORDER BY created_at DESC")
        ).fetchall()
    return [{"id": r[0], "score_avg": r[1], "created_at": str(r[2])} for r in rows]


@app.get("/eval/runs/{run_id}")
def get_run(run_id: int):
    with engine.connect() as conn:
        run = conn.execute(
            text("SELECT id, score_avg, created_at FROM eval_runs WHERE id = :id"),
            {"id": run_id}
        ).fetchone()
        if not run:
            raise HTTPException(status_code=404, detail="Run not found")
        results = conn.execute(
            text("""
                SELECT er.id, q.question, q.expected_answer, er.actual_answer, er.score, er.human_score
                FROM eval_results er
                JOIN quiz_questions q ON er.question_id = q.id
                WHERE er.run_id = :run_id
                ORDER BY er.id
            """),
            {"run_id": run_id}
        ).fetchall()
    return {
        "id": run[0], "score_avg": run[1], "created_at": str(run[2]),
        "results": [
            {"id": r[0], "question": r[1], "expected_answer": r[2], "actual_answer": r[3], "score": r[4], "human_score": r[5]}
            for r in results
        ]
    }




@app.patch("/eval/results/{result_id}")
def patch_result(result_id: int, body: dict):
    """Set human_score: 10 for thumbs up, 0 for thumbs down, null to clear."""
    human_score = body.get("human_score")  # 10, 0, or None
    with engine.connect() as conn:
        result = conn.execute(
            text("UPDATE eval_results SET human_score = :human_score WHERE id = :id RETURNING id"),
            {"human_score": human_score, "id": result_id}
        )
        if not result.fetchone():
            raise HTTPException(status_code=404, detail="Result not found")
        conn.commit()
    return {"id": result_id, "human_score": human_score}

@app.post("/eval/generate")
def eval_generate():
    """Pick 5 random chunks from the KB, generate a Q+A for each, save to quiz_questions."""
    def generate():
        yield f"data: {json.dumps({'type': 'status', 'text': 'Loading knowledge base...'})}\n\n"

        all_chunks = load_chunks_with_page()
        if len(all_chunks) < EVAL_QUESTIONS:
            yield f"data: {json.dumps({'type': 'error', 'text': 'Not enough chunks in knowledge base. Ingest more pages first.'})}\n\n"
            return

        # Balanced sampling: pick chunks evenly across pages
        by_page = {}
        for chunk in all_chunks:
            by_page.setdefault(chunk["page_id"], []).append(chunk)

        selected = []
        page_ids = list(by_page.keys())
        random.shuffle(page_ids)
        idx = 0
        while len(selected) < EVAL_QUESTIONS:
            page_id = page_ids[idx % len(page_ids)]
            if by_page[page_id]:
                chunk = random.choice(by_page[page_id])
                by_page[page_id].remove(chunk)
                selected.append(chunk)
            idx += 1

        saved = []

        for i, chunk in enumerate(selected):
            page_label = chunk["title"][:40]
            yield f"data: {json.dumps({'type': 'status', 'text': f'Generating question {i+1}/{EVAL_QUESTIONS} (from: {page_label})...'})}\n\n"

            prompt = f"""You are a quiz generator. Read the following text and generate exactly ONE clear factual question and its answer.

Text:
{chunk['text']}

Respond in this exact JSON format with no extra text:
{{"question": "...", "answer": "..."}}"""

            try:
                raw = call_ollama_sync(prompt, timeout=120)
                raw = re.sub(r'^```(?:json)?\s*', '', raw.strip())
                raw = re.sub(r'\s*```$', '', raw.strip())
                match = re.search(r'\{.*?\}', raw, re.DOTALL)
                if not match:
                    raise ValueError("No JSON object found in response")
                qa              = json.loads(match.group())
                question        = qa.get("question", "").strip()
                expected_answer = qa.get("answer", "").strip()
                if not question or not expected_answer:
                    raise ValueError("Empty Q or A")
                if expected_answer in ("...", "answer", "Answer"):
                    raise ValueError("Placeholder answer not replaced by model")
            except Exception as e:
                yield f"data: {json.dumps({'type': 'warning', 'text': f'Question {i+1} failed, skipping: {str(e)}'})}\n\n"
                continue

            with engine.connect() as conn:
                result = conn.execute(
                    text("INSERT INTO quiz_questions (page_id, question, expected_answer) VALUES (:page_id, :question, :expected_answer) RETURNING id"),
                    {"page_id": chunk["page_id"], "question": question, "expected_answer": expected_answer}
                )
                qid = result.fetchone()[0]
                conn.commit()

            saved.append({"id": qid, "question": question, "expected_answer": expected_answer, "page_title": chunk["title"]})
            yield f"data: {json.dumps({'type': 'question', 'question': question, 'expected_answer': expected_answer, 'page_title': chunk['title']})}\n\n"

        yield f"data: {json.dumps({'type': 'done', 'count': len(saved)})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.post("/eval/run")
def eval_run():
    """Run evaluation: BM25 retrieve → Ollama answer → Ollama judge (0-10) for each question."""
    def generate():
        # Load questions
        with engine.connect() as conn:
            rows = conn.execute(
                text("SELECT id, question, expected_answer FROM quiz_questions ORDER BY created_at DESC LIMIT :n"),
                {"n": EVAL_QUESTIONS}
            ).fetchall()
        questions = [{"id": r[0], "question": r[1], "expected_answer": r[2]} for r in rows]

        if not questions:
            yield f"data: {json.dumps({'type': 'error', 'text': 'No questions found. Generate questions first.'})}\n\n"
            return

        # Create eval run record
        with engine.connect() as conn:
            result = conn.execute(text("INSERT INTO eval_runs (score_avg) VALUES (NULL) RETURNING id"))
            run_id = result.fetchone()[0]
            conn.commit()

        yield f"data: {json.dumps({'type': 'status', 'text': f'Starting evaluation of {len(questions)} questions...'})}\n\n"

        all_chunks = load_chunks()
        scores     = []

        for i, q in enumerate(questions):
            # Step 1 — retrieve
            yield f"data: {json.dumps({'type': 'progress', 'step': 'retrieving', 'question_num': i+1, 'total': len(questions), 'question': q['question']})}\n\n"
            context = bm25_retrieve(q["question"], all_chunks) if all_chunks else ""

            # Step 2 — answer
            yield f"data: {json.dumps({'type': 'progress', 'step': 'answering', 'question_num': i+1, 'total': len(questions), 'question': q['question']})}\n\n"
            answer_prompt = f"""You are a helpful assistant. Answer the question using ONLY the context below.
If the answer is not in the context, say "I don't have information about that."
Keep your answer concise — 1 to 2 sentences maximum.

Context:
{context}

Question: {q['question']}

Answer:"""
            try:
                actual_answer = call_ollama_sync(answer_prompt, timeout=120)
            except Exception as e:
                actual_answer = f"[error: {e}]"

            # Step 3 — judge
            yield f"data: {json.dumps({'type': 'progress', 'step': 'judging', 'question_num': i+1, 'total': len(questions), 'question': q['question']})}\n\n"
            judge_prompt = f"""You are an evaluation judge. Score the following answer compared to the expected answer.

Question: {q['question']}
Expected answer: {q['expected_answer']}
Actual answer: {actual_answer}

Give a score from 0 to 10 where:
- 10 = perfect match in meaning
- 7-9 = correct but incomplete or slightly different wording
- 4-6 = partially correct
- 1-3 = mostly wrong but touches on the topic
- 0 = completely wrong or irrelevant

Respond with ONLY a single integer from 0 to 10. No explanation."""
            try:
                score_raw = call_ollama_sync(judge_prompt, timeout=120)
                score     = int(re.search(r'\d+', score_raw).group())
                score     = max(0, min(10, score))
            except:
                score = 0

            scores.append(score)

            # Save result
            with engine.connect() as conn:
                row = conn.execute(
                    text("INSERT INTO eval_results (run_id, question_id, actual_answer, score) VALUES (:run_id, :question_id, :actual_answer, :score) RETURNING id"),
                    {"run_id": run_id, "question_id": q["id"], "actual_answer": actual_answer, "score": score}
                )
                result_id = row.fetchone()[0]
                conn.commit()

            yield f"data: {json.dumps({'type': 'result', 'id': result_id, 'question_num': i+1, 'total': len(questions), 'question': q['question'], 'expected_answer': q['expected_answer'], 'actual_answer': actual_answer, 'score': score})}\n\n"

        # Finalize run
        score_avg = round(sum(scores) / len(scores), 1) if scores else 0
        with engine.connect() as conn:
            conn.execute(
                text("UPDATE eval_runs SET score_avg = :score_avg WHERE id = :id"),
                {"score_avg": score_avg, "id": run_id}
            )
            conn.commit()

        yield f"data: {json.dumps({'type': 'done', 'run_id': run_id, 'score_avg': score_avg, 'total': len(questions)})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.get("/logs/stream")
async def logs_stream():
    async def generate():
        procs = {}
        for service, container in CONTAINERS.items():
            try:
                proc = await asyncio.create_subprocess_exec(
                    "docker", "logs", "--follow", "--tail", "50", container,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                )
                procs[service] = proc
            except Exception as e:
                yield f"data: {json.dumps({'service': service, 'line': f'[error] could not attach: {e}'})}\n\n"

        if not procs:
            return

        queue = asyncio.Queue()

        async def pipe(service, proc):
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                await queue.put((service, line.decode("utf-8", errors="replace").rstrip()))
            await queue.put((service, None))

        tasks = [asyncio.create_task(pipe(svc, proc)) for svc, proc in procs.items()]
        done_count = 0

        try:
            while done_count < len(procs):
                try:
                    service, line = await asyncio.wait_for(queue.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                if line is None:
                    done_count += 1
                    continue
                yield f"data: {json.dumps({'service': service, 'line': line})}\n\n"
        finally:
            for task in tasks:
                task.cancel()
            for proc in procs.values():
                try:
                    proc.kill()
                except:
                    pass

    return StreamingResponse(generate(), media_type="text/event-stream")