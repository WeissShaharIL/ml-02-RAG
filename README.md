# ml-02-RAG

A local RAG (Retrieval Augmented Generation) platform built with Docker Compose.
Feed it web pages, evaluate retrieval quality, and chat with your knowledge base — all from a dashboard UI.

---

## Architecture

```
Chat UI (React :3000)        Dashboard UI (React :3001)
        │                              │
        └──────────────┬───────────────┘
                       │
               FastAPI Backend (:8000)
                       │
          ┌────────────┴────────────┐
          │                         │
     PostgreSQL (:5432)        Ollama (:11434)
     ./data/postgres            ./data/ollama
```

| Service | Role |
|---|---|
| Chat UI | User-facing chat interface |
| Dashboard UI | DevOps pipeline control center |
| FastAPI Backend | BM25 retrieval + query rewriting + RAG + eval pipeline |
| PostgreSQL | Stores pages, chunks, quiz bank, eval results |
| Ollama | Runs llama3.2:3b locally for generation and evaluation |

---

## How RAG works here

The model (Ollama) is **never retrained**. Its weights are frozen.
Knowledge lives in PostgreSQL. Retrieval quality determines answer quality.

```
User question
    → Query rewriting (Ollama fixes typos/grammar)
    → BM25 retrieval (finds best chunks from PostgreSQL)
    → Ollama reads chunks + generates answer
    → Answer streamed back to user token by token
```

---

## Pipeline

Managed from the Dashboard UI:

```
1. Ingest    → submit a URL or paste text → page chunked and stored in PostgreSQL
2. Inspect   → click any page to view raw content and chunks
3. Generate  → Ollama creates quiz questions from knowledge base (balanced across pages)
4. Evaluate  → BM25 retrieve → Ollama answer → Ollama judge (0–10) → score
5. History   → view all past eval runs and per-question breakdowns
```

---

## Getting Started

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Node.js 20+](https://github.com/coreybutler/nvm-windows) (for local frontend build)

### First time setup

```powershell
# Clone the repo
git clone https://github.com/WeissShaharIL/ml-02-RAG
cd ml-02-RAG

# Build frontends and start all services
.\build.ps1
```

The first run will download the llama3.2:3b model (~2GB). Check progress:

```powershell
docker logs rag-ollama --tail 30
```

Wait until you see `success` before chatting.

### Daily use

```powershell
# Start everything
docker compose up

# Stop everything
docker compose down

# Rebuild after code changes
.\build.ps1
```

---

## GPU / CPU config

Edit `.env` before starting:

```env
# CPU (default)
GPU_ENABLED=false
GPU_DRIVER=
GPU_COUNT=
GPU_CAPS=

# NVIDIA GPU
GPU_ENABLED=true
GPU_DRIVER=nvidia
GPU_COUNT=1
GPU_CAPS=[gpu]
```

---

## URLs

| Service | URL |
|---|---|
| Chat UI | http://localhost:3000 |
| Dashboard | http://localhost:3001 |
| Backend API | http://localhost:8000 |
| Backend Health | http://localhost:8000/health |
| Ollama | http://localhost:11434 |

---

## Project Structure

```
ml-02-RAG/
├── .env                       ← GPU/CPU config
├── docker-compose.yml
├── build.ps1                  ← build frontends + start docker
├── README.md
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── main.py                ← FastAPI: ingest, BM25, RAG, eval, logs
├── frontend-chat/
│   ├── Dockerfile
│   ├── nginx.conf
│   └── src/App.jsx            ← streaming chat UI
├── frontend-dash/
│   ├── Dockerfile
│   ├── nginx.conf
│   └── src/App.jsx            ← dashboard: health, ingest, eval, live logs
├── ollama/
│   ├── Dockerfile
│   └── start.sh               ← auto-pulls llama3.2:3b on first start
└── data/
    ├── postgres/              ← postgres data (gitignored)
    └── ollama/                ← ollama model cache (gitignored)
```

---

## Backend Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Service health check |
| POST | `/ingest/url` | Scrape and ingest a URL |
| POST | `/ingest/text` | Ingest pasted text |
| GET | `/pages` | List all ingested pages |
| GET | `/pages/{id}` | Get page content |
| GET | `/pages/{id}/chunks` | Get page chunks |
| DELETE | `/pages/{id}` | Delete page and its chunks |
| POST | `/ask` | RAG query (SSE streaming) |
| POST | `/eval/generate` | Generate quiz questions (SSE streaming) |
| POST | `/eval/run` | Run evaluation (SSE streaming) |
| GET | `/eval/questions` | List all quiz questions |
| GET | `/eval/runs` | List all eval runs |
| GET | `/eval/runs/{id}` | Get full results for a run |
| GET | `/logs/stream` | Live container logs (SSE) |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite |
| Backend | FastAPI (Python) |
| Database | PostgreSQL 16 |
| LLM | Ollama + llama3.2:3b |
| Retrieval | BM25 (rank-bm25) |
| Serving | Nginx |
| Containerization | Docker Compose |

---

## Roadmap

- [x] Phase 1 — Skeleton: all services running, health checks
- [x] Phase 2 — Ingest + BM25 retrieval + streaming chat + live logs dashboard
- [x] Phase 3 — Quiz generation + evaluation pipeline + eval history
- [ ] Phase 4 — Deploy/rollback from dashboard
- [ ] Phase 5 — Embeddings + vector search (replace BM25)
