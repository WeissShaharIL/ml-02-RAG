from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, text
import os
import requests

app = FastAPI(title="RAG Platform API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DATABASE_URL = os.getenv("DATABASE_URL")
OLLAMA_URL   = os.getenv("OLLAMA_URL", "http://ollama:11434")

engine = create_engine(DATABASE_URL)


def check_postgres() -> bool:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except:
        return False


def check_ollama() -> bool:
    try:
        res = requests.get(f"{OLLAMA_URL}/api/tags", timeout=3)
        return res.status_code == 200
    except:
        return False


@app.get("/health")
def health():
    pg      = check_postgres()
    ollama  = check_ollama()
    return {
        "status":   "ok" if pg and ollama else "degraded",
        "postgres": "up" if pg     else "down",
        "ollama":   "up" if ollama else "down",
    }