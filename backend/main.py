import os
import re
import json
import asyncio
import random
import string
import time
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
OLLAMA_MODEL       = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
OLLAMA_JUDGE_MODEL = os.getenv("OLLAMA_JUDGE_MODEL", OLLAMA_MODEL)
CHUNK_WORDS  = 300
TOP_K        = 2
EVAL_QUESTIONS = 10

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
                id               SERIAL PRIMARY KEY,
                score_avg        FLOAT,
                duration_seconds INTEGER,
                ollama_model     TEXT,
                judge_model      TEXT,
                created_at       TIMESTAMP DEFAULT NOW()
            )
        """))
        try:
            conn.execute(text("ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS ollama_model TEXT"))
            conn.execute(text("ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS judge_model TEXT"))
        except:
            pass
        try:
            conn.execute(text("ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS duration_seconds INTEGER"))
        except:
            pass
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
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS versions (
                id              SERIAL PRIMARY KEY,
                name            TEXT NOT NULL UNIQUE,
                score_avg       FLOAT,
                human_score_avg FLOAT,
                page_count      INTEGER NOT NULL DEFAULT 0,
                status          TEXT NOT NULL DEFAULT 'saved',
                created_at      TIMESTAMP DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS version_pages (
                id               SERIAL PRIMARY KEY,
                version_id       INTEGER REFERENCES versions(id) ON DELETE CASCADE,
                original_page_id INTEGER,
                title            TEXT NOT NULL,
                url              TEXT,
                content          TEXT NOT NULL,
                created_at       TIMESTAMP
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS version_chunks (
                id              SERIAL PRIMARY KEY,
                version_page_id INTEGER REFERENCES version_pages(id) ON DELETE CASCADE,
                position        INTEGER NOT NULL,
                text            TEXT NOT NULL
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS version_eval_results (
                id               SERIAL PRIMARY KEY,
                version_id       INTEGER REFERENCES versions(id) ON DELETE CASCADE,
                question         TEXT NOT NULL,
                expected_answer  TEXT NOT NULL,
                actual_answer    TEXT,
                ollama_score     INTEGER,
                human_score      INTEGER,
                created_at       TIMESTAMP DEFAULT NOW()
            )
        """))
        try:
            conn.execute(text("ALTER TABLE versions ADD COLUMN IF NOT EXISTS human_score_avg FLOAT"))
        except:
            pass
        try:
            conn.execute(text("ALTER TABLE eval_results ADD COLUMN IF NOT EXISTS human_score INTEGER"))
        except:
            pass
        conn.commit()

@app.on_event("startup")
def startup():
    init_db()
    print("DB initialized.")
    print(f"Main model:  {OLLAMA_MODEL}")
    print(f"Judge model: {OLLAMA_JUDGE_MODEL}")
    if OLLAMA_JUDGE_MODEL != OLLAMA_MODEL:
        print(f"Pulling judge model {OLLAMA_JUDGE_MODEL}...")
        try:
            requests.post(f"{OLLAMA_URL}/api/pull", json={"name": OLLAMA_JUDGE_MODEL}, timeout=(10, 600))
            print(f"Judge model {OLLAMA_JUDGE_MODEL} ready.")
        except Exception as e:
            print(f"Warning: could not pull judge model: {e}")

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
    """Load live chunks (no active production version)."""
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT text FROM chunks ORDER BY page_id, position")
        ).fetchall()
    return [row[0] for row in rows]


def load_chunks_for_ask() -> list[str]:
    """Load chunks for /ask — uses production version if one exists, else live chunks."""
    with engine.connect() as conn:
        prod = conn.execute(
            text("SELECT id FROM versions WHERE status = 'production' LIMIT 1")
        ).fetchone()

        if prod:
            rows = conn.execute(
                text("""
                    SELECT vc.text
                    FROM version_chunks vc
                    JOIN version_pages vp ON vc.version_page_id = vp.id
                    WHERE vp.version_id = :version_id
                    ORDER BY vp.id, vc.position
                """),
                {"version_id": prod[0]}
            ).fetchall()
        else:
            rows = conn.execute(
                text("SELECT text FROM chunks ORDER BY page_id, position")
            ).fetchall()

    return [row[0] for row in rows]


def get_production_version() -> Optional[dict]:
    """Return the active production version or None."""
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT id, name FROM versions WHERE status = 'production' LIMIT 1")
        ).fetchone()
    return {"id": row[0], "name": row[1]} if row else None


def load_chunks_with_page() -> list[dict]:
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


def call_ollama_sync(prompt: str, timeout: int = 600, model: str = None) -> str:
    payload  = {"model": model or OLLAMA_MODEL, "prompt": prompt, "stream": False}
    response = requests.post(f"{OLLAMA_URL}/api/generate", json=payload, timeout=(10, timeout))
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
        return call_ollama_sync(prompt, timeout=600)
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

class EvalGenerateRequest(BaseModel):
    num_questions: int = 10

class EvalRunRequest(BaseModel):
    num_questions: int = 10
    cycles:        int = 1

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

    prod = get_production_version()
    return {
        "status":             "ok" if pg == "up" and ollama == "up" else "degraded",
        "postgres":           pg,
        "ollama":             ollama,
        "production_version": prod,  # {"id": ..., "name": ...} or None
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

        # Use production version chunks if deployed, else live chunks
        chunks = load_chunks_for_ask()
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


@app.delete("/eval/questions/{question_id}")
def delete_question(question_id: int):
    with engine.connect() as conn:
        result = conn.execute(
            text("DELETE FROM quiz_questions WHERE id = :id RETURNING id"),
            {"id": question_id}
        )
        if not result.fetchone():
            raise HTTPException(status_code=404, detail="Question not found")
        conn.commit()
    return {"deleted": question_id}


@app.get("/eval/runs")
def list_runs():
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT
                er.id,
                er.score_avg,
                er.duration_seconds,
                er.created_at,
                ROUND(AVG(res.human_score)::numeric, 1) AS human_score_avg,
                COUNT(res.human_score)                  AS human_rated_count,
                er.ollama_model,
                er.judge_model
            FROM eval_runs er
            LEFT JOIN eval_results res ON res.run_id = er.id AND res.human_score IS NOT NULL
            GROUP BY er.id
            ORDER BY er.created_at DESC
        """)).fetchall()
    return [{"id": r[0], "score_avg": r[1], "duration_seconds": r[2], "created_at": str(r[3]),
             "human_score_avg": float(r[4]) if r[4] is not None else None,
             "human_rated_count": r[5], "ollama_model": r[6], "judge_model": r[7]} for r in rows]


@app.get("/eval/runs/{run_id}")
def get_run(run_id: int):
    with engine.connect() as conn:
        run = conn.execute(
            text("SELECT id, score_avg, duration_seconds, created_at, ollama_model, judge_model FROM eval_runs WHERE id = :id"),
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
    with engine.connect() as conn2:
        human = conn2.execute(text("""
            SELECT ROUND(AVG(human_score)::numeric, 1), COUNT(human_score)
            FROM eval_results WHERE run_id = :id AND human_score IS NOT NULL
        """), {"id": run_id}).fetchone()
    return {
        "id": run[0], "score_avg": run[1], "duration_seconds": run[2], "created_at": str(run[3]),
        "ollama_model": run[4], "judge_model": run[5],
        "human_score_avg": float(human[0]) if human[0] is not None else None,
        "human_rated_count": human[1],
        "results": [
            {"id": r[0], "question": r[1], "expected_answer": r[2], "actual_answer": r[3], "score": r[4], "human_score": r[5]}
            for r in results
        ]
    }


@app.patch("/eval/results/{result_id}")
def patch_result(result_id: int, body: dict):
    human_score = body.get("human_score")
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
def eval_generate(req: EvalGenerateRequest = EvalGenerateRequest()):
    n = max(1, min(req.num_questions, 50))

    def generate():
        yield f"data: {json.dumps({'type': 'status', 'text': 'Loading knowledge base...'})}\n\n"

        all_chunks = load_chunks_with_page()
        if len(all_chunks) < n:
            yield f"data: {json.dumps({'type': 'error', 'text': f'Not enough chunks ({len(all_chunks)}) to generate {n} questions.'})}\n\n"
            return

        by_page = {}
        for chunk in all_chunks:
            by_page.setdefault(chunk["page_id"], []).append(chunk)

        selected = []
        page_ids = list(by_page.keys())
        random.shuffle(page_ids)
        idx = 0
        while len(selected) < n:
            page_id = page_ids[idx % len(page_ids)]
            if by_page[page_id]:
                chunk = random.choice(by_page[page_id])
                by_page[page_id].remove(chunk)
                selected.append(chunk)
            idx += 1

        saved = []

        for i, chunk in enumerate(selected):
            page_label = chunk["title"][:40]
            yield f"data: {json.dumps({'type': 'status', 'text': f'Generating question {i+1}/{n} (from: {page_label})...'})}\n\n"

            prompt = f"""You are a quiz generator. Read the following text and generate exactly ONE clear factual question and its answer.

Text:
{chunk['text']}

Respond in this exact JSON format with no extra text:
{{"question": "...", "answer": "..."}}"""

            try:
                raw = call_ollama_sync(prompt, timeout=600)
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
            yield f"data: {json.dumps({'type': 'question', 'id': qid, 'question': question, 'expected_answer': expected_answer, 'page_title': chunk['title']})}\n\n"

        yield f"data: {json.dumps({'type': 'done', 'count': len(saved)})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.post("/eval/run")
def eval_run(req: EvalRunRequest = EvalRunRequest()):
    num_questions = max(1, min(req.num_questions, EVAL_QUESTIONS))
    cycles        = max(1, min(req.cycles, 5))

    def generate():
        with engine.connect() as conn:
            all_rows = conn.execute(
                text("SELECT id, question, expected_answer FROM quiz_questions ORDER BY created_at DESC")
            ).fetchall()
        all_questions = [{"id": r[0], "question": r[1], "expected_answer": r[2]} for r in all_rows]

        if not all_questions:
            yield f"data: {json.dumps({'type': 'error', 'text': 'No questions found. Generate questions first.'})}\n\n"
            return

        yield f"data: {json.dumps({'type': 'status', 'text': f'Starting {cycles} evaluation cycle(s) of {num_questions} questions each...'})}\n\n"

        for cycle in range(cycles):
            questions = random.sample(all_questions, min(num_questions, len(all_questions)))

            if cycles > 1:
                yield f"data: {json.dumps({'type': 'status', 'text': f'Cycle {cycle+1}/{cycles}...'})}\n\n"

            with engine.connect() as conn:
                result = conn.execute(
                    text("INSERT INTO eval_runs (score_avg, ollama_model, judge_model) VALUES (NULL, :ollama_model, :judge_model) RETURNING id"),
                    {"ollama_model": OLLAMA_MODEL, "judge_model": OLLAMA_JUDGE_MODEL}
                )
                run_id = result.fetchone()[0]
                conn.commit()

            run_start  = time.time()
            all_chunks = load_chunks()
            scores     = []

            yield f"data: {json.dumps({'type': 'status', 'text': f'Cycle {cycle+1}/{cycles} — evaluating {len(questions)} questions...'})}\n\n"

            for i, q in enumerate(questions):
                yield f"data: {json.dumps({'type': 'progress', 'step': 'retrieving', 'question_num': i+1, 'total': len(questions), 'question': q['question']})}\n\n"
                context = bm25_retrieve(q["question"], all_chunks) if all_chunks else ""

                yield f"data: {json.dumps({'type': 'progress', 'step': 'answering', 'question_num': i+1, 'total': len(questions), 'question': q['question']})}\n\n"
                answer_prompt = f"""You are a helpful assistant. Answer the question using ONLY the context below.
If the answer is not in the context, say "I don't have information about that."
Keep your answer concise — 1 to 2 sentences maximum.

Context:
{context}

Question: {q['question']}

Answer:"""
                try:
                    actual_answer = call_ollama_sync(answer_prompt, timeout=600)
                except Exception as e:
                    actual_answer = f"[error: {e}]"

                yield f"data: {json.dumps({'type': 'progress', 'step': 'judging', 'question_num': i+1, 'total': len(questions), 'question': q['question']})}\n\n"
                judge_prompt = f"""You are an evaluation judge. Your job is to check whether the actual answer contains the correct information from the expected answer.

Question: {q['question']}
Expected answer: {q['expected_answer']}
Actual answer: {actual_answer}

Scoring rules:
- 10 = the actual answer contains the correct information, even if phrased differently or as a full sentence
- 7-9 = mostly correct, minor omission or slight inaccuracy
- 4-6 = partially correct, contains some right information but missing key parts
- 1-3 = mostly wrong but tangentially related
- 0 = completely wrong, irrelevant, or "I don't have information about that"

IMPORTANT: Do NOT penalize for different phrasing, extra context, or full sentences vs fragments.
Only check if the core factual content is correct.

Respond with ONLY a single integer from 0 to 10. No explanation."""
                try:
                    score_raw = call_ollama_sync(judge_prompt, timeout=600, model=OLLAMA_JUDGE_MODEL)
                    score     = int(re.search(r'\d+', score_raw).group())
                    score     = max(0, min(10, score))
                except:
                    score = 0

                scores.append(score)

                with engine.connect() as conn:
                    row = conn.execute(
                        text("INSERT INTO eval_results (run_id, question_id, actual_answer, score) VALUES (:run_id, :question_id, :actual_answer, :score) RETURNING id"),
                        {"run_id": run_id, "question_id": q["id"], "actual_answer": actual_answer, "score": score}
                    )
                    result_id = row.fetchone()[0]
                    conn.commit()

                yield f"data: {json.dumps({'type': 'result', 'id': result_id, 'question_num': i+1, 'total': len(questions), 'question': q['question'], 'expected_answer': q['expected_answer'], 'actual_answer': actual_answer, 'score': score})}\n\n"

            score_avg        = round(sum(scores) / len(scores), 1) if scores else 0
            duration_seconds = int(time.time() - run_start)
            with engine.connect() as conn:
                conn.execute(
                    text("UPDATE eval_runs SET score_avg = :score_avg, duration_seconds = :duration WHERE id = :id"),
                    {"score_avg": score_avg, "duration": duration_seconds, "id": run_id}
                )
                conn.commit()

            yield f"data: {json.dumps({'type': 'cycle_done', 'cycle': cycle+1, 'cycles': cycles, 'run_id': run_id, 'score_avg': score_avg, 'total': len(questions), 'duration_seconds': duration_seconds})}\n\n"

        yield f"data: {json.dumps({'type': 'done', 'cycles': cycles})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


# ── Version endpoints ──────────────────────────────────────────────────────────

@app.post("/versions/save")
def save_version():
    with engine.connect() as conn:
        pages = conn.execute(
            text("SELECT id, title, url, content, created_at FROM pages ORDER BY created_at")
        ).fetchall()

        if not pages:
            raise HTTPException(status_code=400, detail="No pages to snapshot. Ingest some pages first.")

        run = conn.execute(
            text("""
                SELECT er.score_avg,
                       ROUND(AVG(res.human_score)::numeric, 1),
                       COUNT(res.human_score)
                FROM eval_runs er
                LEFT JOIN eval_results res ON res.run_id = er.id AND res.human_score IS NOT NULL
                WHERE er.score_avg IS NOT NULL
                GROUP BY er.id
                ORDER BY er.created_at DESC LIMIT 1
            """)
        ).fetchone()
        score_avg       = run[0] if run else None
        human_score_avg = float(run[1]) if run and run[1] is not None else None

        while True:
            name = ''.join(random.choices(string.ascii_lowercase + string.digits, k=7))
            existing = conn.execute(text("SELECT id FROM versions WHERE name = :name"), {"name": name}).fetchone()
            if not existing:
                break

        version_row = conn.execute(
            text("INSERT INTO versions (name, score_avg, human_score_avg, page_count) VALUES (:name, :score_avg, :human_score_avg, :page_count) RETURNING id"),
            {"name": name, "score_avg": score_avg, "human_score_avg": human_score_avg, "page_count": len(pages)}
        )
        version_id = version_row.fetchone()[0]

        for page in pages:
            vpage_row = conn.execute(
                text("""INSERT INTO version_pages (version_id, original_page_id, title, url, content, created_at)
                        VALUES (:version_id, :original_page_id, :title, :url, :content, :created_at) RETURNING id"""),
                {"version_id": version_id, "original_page_id": page[0], "title": page[1],
                 "url": page[2], "content": page[3], "created_at": page[4]}
            )
            vpage_id = vpage_row.fetchone()[0]

            chunks = conn.execute(
                text("SELECT position, text FROM chunks WHERE page_id = :page_id ORDER BY position"),
                {"page_id": page[0]}
            ).fetchall()

            for chunk in chunks:
                conn.execute(
                    text("INSERT INTO version_chunks (version_page_id, position, text) VALUES (:vpage_id, :position, :text)"),
                    {"vpage_id": vpage_id, "position": chunk[0], "text": chunk[1]}
                )

        eval_rows = conn.execute(text("""
            SELECT q.question, q.expected_answer, er.actual_answer, er.score, er.human_score
            FROM eval_results er
            JOIN quiz_questions q ON er.question_id = q.id
            WHERE er.run_id = (
                SELECT id FROM eval_runs WHERE score_avg IS NOT NULL ORDER BY created_at DESC LIMIT 1
            )
            ORDER BY er.id
        """)).fetchall()

        for er in eval_rows:
            conn.execute(
                text("""INSERT INTO version_eval_results
                        (version_id, question, expected_answer, actual_answer, ollama_score, human_score)
                        VALUES (:version_id, :question, :expected_answer, :actual_answer, :ollama_score, :human_score)"""),
                {"version_id": version_id, "question": er[0], "expected_answer": er[1],
                 "actual_answer": er[2], "ollama_score": er[3], "human_score": er[4]}
            )

        conn.commit()

    return {
        "version_name":       name,
        "page_count":         len(pages),
        "score_avg":          score_avg,
        "human_score_avg":    human_score_avg,
        "eval_results_saved": len(eval_rows),
    }


@app.post("/versions/{version_id}/deploy")
def deploy_version(version_id: int):
    """Set this version as production. Demote any existing production to retired."""
    with engine.connect() as conn:
        version = conn.execute(
            text("SELECT id, name, status FROM versions WHERE id = :id"),
            {"id": version_id}
        ).fetchone()
        if not version:
            raise HTTPException(status_code=404, detail="Version not found")

        # Demote current production (if any) to retired
        conn.execute(
            text("UPDATE versions SET status = 'retired' WHERE status = 'production'")
        )

        # Promote this version
        conn.execute(
            text("UPDATE versions SET status = 'production' WHERE id = :id"),
            {"id": version_id}
        )
        conn.commit()

    return {"version_id": version_id, "name": version[1], "status": "production"}


@app.post("/versions/{version_id}/rollback")
def rollback_version(version_id: int):
    """Retire the current production version and re-promote this one to production."""
    with engine.connect() as conn:
        version = conn.execute(
            text("SELECT id, name, status FROM versions WHERE id = :id"),
            {"id": version_id}
        ).fetchone()
        if not version:
            raise HTTPException(status_code=404, detail="Version not found")
        if version[2] == 'production':
            raise HTTPException(status_code=400, detail="Version is already in production")

        # Demote current production to retired
        conn.execute(
            text("UPDATE versions SET status = 'retired' WHERE status = 'production'")
        )

        # Promote requested version back to production
        conn.execute(
            text("UPDATE versions SET status = 'production' WHERE id = :id"),
            {"id": version_id}
        )
        conn.commit()

    return {"version_id": version_id, "name": version[1], "status": "production"}


@app.post("/versions/{version_id}/undeploy")
def undeploy_version(version_id: int):
    """Take production version back to saved (chat falls back to live data)."""
    with engine.connect() as conn:
        version = conn.execute(
            text("SELECT id, name, status FROM versions WHERE id = :id"),
            {"id": version_id}
        ).fetchone()
        if not version:
            raise HTTPException(status_code=404, detail="Version not found")
        if version[2] != 'production':
            raise HTTPException(status_code=400, detail="Version is not in production")

        conn.execute(
            text("UPDATE versions SET status = 'saved' WHERE id = :id"),
            {"id": version_id}
        )
        conn.commit()

    return {"version_id": version_id, "name": version[1], "status": "saved"}


@app.get("/versions/{version_id}/eval")
def get_version_eval(version_id: int):
    with engine.connect() as conn:
        rows = conn.execute(
            text("""SELECT question, expected_answer, actual_answer, ollama_score, human_score
                    FROM version_eval_results WHERE version_id = :id ORDER BY id"""),
            {"id": version_id}
        ).fetchall()
    return [{"question": r[0], "expected_answer": r[1], "actual_answer": r[2],
             "ollama_score": r[3], "human_score": r[4]} for r in rows]


@app.get("/versions")
def list_versions():
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT id, name, score_avg, human_score_avg, page_count, status, created_at FROM versions ORDER BY created_at DESC")
        ).fetchall()
    return [{"id": r[0], "name": r[1], "score_avg": r[2], "human_score_avg": r[3],
             "page_count": r[4], "status": r[5], "created_at": str(r[6])} for r in rows]


@app.post("/reset")
def reset_all():
    with engine.connect() as conn:
        conn.execute(text("TRUNCATE TABLE eval_results         RESTART IDENTITY CASCADE"))
        conn.execute(text("TRUNCATE TABLE eval_runs            RESTART IDENTITY CASCADE"))
        conn.execute(text("TRUNCATE TABLE quiz_questions       RESTART IDENTITY CASCADE"))
        conn.execute(text("TRUNCATE TABLE chunks               RESTART IDENTITY CASCADE"))
        conn.execute(text("TRUNCATE TABLE pages                RESTART IDENTITY CASCADE"))
        conn.execute(text("TRUNCATE TABLE version_eval_results RESTART IDENTITY CASCADE"))
        conn.execute(text("TRUNCATE TABLE version_chunks       RESTART IDENTITY CASCADE"))
        conn.execute(text("TRUNCATE TABLE version_pages        RESTART IDENTITY CASCADE"))
        conn.execute(text("TRUNCATE TABLE versions             RESTART IDENTITY CASCADE"))
        conn.commit()
    return {"status": "ok", "message": "All data wiped. System is ready for fresh ingestion."}


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