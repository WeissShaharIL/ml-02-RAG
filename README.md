# ml-02-RAG

A local RAG (Retrieval Augmented Generation) platform built with Docker Compose.
Feed it Wikipedia pages, evaluate retrieval quality, and deploy to production — all from a dashboard UI.

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
```

| Service | Role |
|---|---|
| Chat UI | User-facing chat interface |
| Dashboard UI | DevOps pipeline control center |
| FastAPI Backend | BM25 retrieval + query rewriting + RAG |
| PostgreSQL | Stores pages, chunks, quiz bank, eval results, versions |
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
    → Answer returned to user
```

---

## Pipeline

Managed from the Dashboard UI:

```
1. Ingest    → submit a Wikipedia URL → page stored in PostgreSQL
2. Generate  → Ollama creates quiz questions from the new page
3. Evaluate  → BM25 retrieve → Ollama answer → Ollama judge → score
4. Deploy    → promote version to production (Chat UI switches to it)
5. Rollback  → revert to previous production version
```

---

## Getting Started

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Node.js 20+](https://github.com/coreybutler/nvm-windows) (for local frontend build)
- [Ollama](https://ollama.com/) (runs inside Docker)

### First time setup

```powershell
# Clone the repo
git clone https://github.com/WeissShaharIL/ml-02-RAG
cd ml-02-RAG

# Build frontends and start all services
.\build.ps1
```

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

## URLs

| Service | URL |
|---|---|
| Chat UI | http://localhost:3000 |
| Dashboard | http://localhost:3001 |
| Backend API | http://localhost:8000 |
| Backend Health | http://localhost:8000/health |
| Ollama | http://localhost:11434 |
| PostgreSQL | localhost:5432 |

---

## Project Structure

```
ml-02-RAG/
├── docker-compose.yml
├── build.ps1                  ← build frontends + start docker
├── README.md
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── main.py
├── frontend-chat/
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   └── src/
│       ├── main.jsx
│       └── App.jsx
└── frontend-dash/
    ├── Dockerfile
    ├── nginx.conf
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        └── App.jsx
```

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
- [ ] Phase 2 — Ingest + retrieval + query rewriting
- [ ] Phase 3 — Quiz generation + evaluation pipeline
- [ ] Phase 4 — Deploy/rollback from dashboard
- [ ] Phase 5 — Embeddings + vector search (replace BM25)
