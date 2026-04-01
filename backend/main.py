import os
import re
import json
import asyncio
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


def call_ollama_sync(prompt: str, timeout: int = 60) -> str:
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


@app.get("/logs/stream")
async def logs_stream():
    """Stream logs from all containers via Docker socket."""

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
            await queue.put((service, None))  # sentinel

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