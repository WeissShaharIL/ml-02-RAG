# ml-02-RAG

A local RAG (Retrieval Augmented Generation) platform built with Docker Compose.
Feed it web pages or text, evaluate retrieval quality, version your knowledge base, and chat — all from a dashboard UI.

The model weights are **frozen**. Ollama never retrains. Knowledge lives in PostgreSQL.
Better answers come from better data, not a different model.

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
| Chat UI | User-facing streaming chat |
| Dashboard UI | Pipeline control: ingest, eval, versions, logs |
| FastAPI Backend | BM25 retrieval, query rewriting, RAG, eval, version routing |
| PostgreSQL | Pages, chunks, quiz bank, eval results, version snapshots |
| Ollama | Runs llama3.2:3b locally for generation, evaluation, and judging |

---

## How RAG works here

```
User question
    → Query rewriting  (Ollama fixes typos/grammar)
    → BM25 retrieval   (finds best matching chunks from PostgreSQL)
    → Answer           (Ollama reads chunks + streams answer token by token)
```

The `/ask` endpoint automatically routes to the **deployed version** if one exists,
or falls back to the live knowledge base if nothing is deployed.

---

## Typical workflow

```
1. Ingest     → submit a URL or paste text → chunked and stored in PostgreSQL
2. Inspect    → click any page in the dashboard to view raw content and chunks
3. Generate   → Ollama creates quiz Q&A pairs from the knowledge base
4. Evaluate   → BM25 retrieve → Ollama answer → Ollama judge scores 0–10
5. Rate       → use 👍/👎 on answers to record your own human score
6. Save       → snapshot current pages + chunks + eval scores as a version
7. Deploy     → promote a version; chat now serves that knowledge base
8. Rollback   → re-promote any retired version if needed
```

---

## Getting Started

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Node.js 20+](https://github.com/coreybutler/nvm-windows)

### First time setup

```powershell
git clone https://github.com/WeissShaharIL/ml-02-RAG
cd ml-02-RAG
.\build.ps1
```

The first run downloads llama3.2:3b (~2GB). Watch progress:

```powershell
docker logs rag-ollama --tail 30
```

Wait for `success` before chatting.

### Daily use

```powershell
# Start
docker compose up

# Stop
docker compose down

# Rebuild after code changes
.\build.ps1

# Rebuild a single service only
docker compose up --build backend
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

## Model config

Also in `.env`:

```env
# Main model: query rewriting, answering
OLLAMA_MODEL=llama3.2:3b

# Judge model: scores eval answers (can be a larger model)
OLLAMA_JUDGE_MODEL=llama3.2:3b
```

If `OLLAMA_JUDGE_MODEL` differs from `OLLAMA_MODEL`, the backend pulls it automatically on startup.

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

## Dashboard walkthrough

### Service Health
Live status dots for Backend, PostgreSQL, and Ollama.

### Versions (left sidebar)
Each saved version shows its name, status badge, page count, Ollama score, and human score.

| Status | Meaning |
|---|---|
| `◆ saved` | Snapshot exists, not serving chat |
| `● live` | Currently serving the chat UI |
| `○ retired` | Was previously deployed, now superseded |

**Actions per version:**
- `🚀 Deploy` — promote a saved version to production; chat now uses its chunks
- `↩ Rollback` — re-promote a retired version to production
- `⏏ Undeploy` — take production offline; chat falls back to live data

The top bar always shows what chat is currently serving:
`Chat → a3f9c12` or `Chat → live data`

### Ingest Knowledge
Submit a URL (scraped with BeautifulSoup) or paste text directly.
Each page is chunked into 300-word overlapping segments and stored in PostgreSQL.

### Knowledge Base
List of all ingested pages. Click a title to view raw content and individual chunks.
Delete pages with inline confirmation.

### Evaluation
Configure and run the eval pipeline:

```
Generate  [10] questions       ← how many Q&A pairs to generate
Evaluate  [10] questions × [1] cycles   ← how many to test, how many times
```

- **⚡ Generate** — Ollama reads random chunks and produces quiz Q&A pairs, balanced across pages
- **▶ Evaluate** — for each question: BM25 retrieves context → Ollama answers → judge model scores 0–10
- **Quiz Bank** — collapsible list of all generated questions, searchable, deletable
- **Results** — live per-question score bars as eval runs, with 👍/👎 human override

### Past Runs (right sidebar)
All eval history. Click any run to expand per-question results with dual Ollama/human scores.

### Live Logs (bottom bar)
Streaming logs from all 3 containers (backend, ollama, postgres).
Filter by service, pause, or clear. Collapsible.

---

## Versioning in depth

A **version** is a full snapshot of the knowledge base at a point in time:
- All page content and chunks (physically copied, not referenced)
- Eval scores from the latest run at save time

Because versions are immutable copies, deleting live pages never affects a deployed version.
The chat UI always queries whichever source is currently active.

**There can only be one `production` version at a time.**
Deploying a new one automatically retires the previous one.

---

## Chunking strategy

| Parameter | Value |
|---|---|
| Chunk size | 300 words |
| Overlap (step) | 150 words (sliding window) |
| Retrieval | BM25, top-2 chunks per query |
| Stop words | Filtered before BM25 tokenization |

---

## Project structure

```
ml-02-RAG/
├── .env                       ← GPU/CPU + model config
├── docker-compose.yml
├── build.ps1                  ← builds React frontends, then starts Docker
├── README.md
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── main.py                ← FastAPI: ingest, BM25, RAG, eval, versions, logs
├── frontend-chat/
│   ├── Dockerfile
│   ├── nginx.conf             ← proxy_buffering off, 1800s timeouts for SSE
│   └── src/App.jsx            ← streaming chat UI with stage indicators
├── frontend-dash/
│   ├── Dockerfile
│   ├── nginx.conf             ← proxy_buffering off, 1800s timeouts for SSE
│   └── src/App.jsx            ← dashboard: 3-column layout, full pipeline
├── ollama/
│   ├── Dockerfile
│   └── start.sh               ← auto-pulls OLLAMA_MODEL on startup
└── data/
    ├── postgres/              ← postgres data volume (gitignored)
    └── ollama/                ← ollama model cache (gitignored)
```

---

## Backend API reference

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Service status + active production version |
| POST | `/ingest/url` | Scrape and ingest a URL |
| POST | `/ingest/text` | Ingest pasted text |
| GET | `/pages` | List all ingested pages |
| GET | `/pages/{id}` | Get page content |
| GET | `/pages/{id}/chunks` | Get page chunks |
| DELETE | `/pages/{id}` | Delete page and its chunks |
| POST | `/ask` | RAG query — SSE stream of tokens |
| POST | `/eval/generate` | Generate quiz questions — SSE stream |
| POST | `/eval/run` | Run evaluation — SSE stream |
| GET | `/eval/questions` | List all quiz questions |
| DELETE | `/eval/questions/{id}` | Delete a quiz question |
| GET | `/eval/runs` | List all eval runs |
| GET | `/eval/runs/{id}` | Full results for a run |
| PATCH | `/eval/results/{id}` | Set human score (10/0/null) |
| POST | `/versions/save` | Snapshot current KB as a new version |
| GET | `/versions` | List all versions with status and scores |
| POST | `/versions/{id}/deploy` | Set version as production |
| POST | `/versions/{id}/rollback` | Re-promote a retired version |
| POST | `/versions/{id}/undeploy` | Take production offline |
| GET | `/versions/{id}/eval` | Get eval results snapshotted in a version |
| POST | `/reset` | Wipe all data (pages, chunks, eval, versions) |
| GET | `/logs/stream` | Live container logs — SSE fan-in |

---

## Database schema

```
pages              — id, title, url, content, created_at
chunks             — id, page_id, position, text
quiz_questions     — id, page_id, question, expected_answer, created_at
eval_runs          — id, score_avg, duration_seconds, ollama_model, judge_model, created_at
eval_results       — id, run_id, question_id, actual_answer, score, human_score, created_at

versions           — id, name (7-char), score_avg, human_score_avg, page_count, status, created_at
version_pages      — id, version_id, original_page_id, title, url, content, created_at
version_chunks     — id, version_page_id, position, text
version_eval_results — id, version_id, question, expected_answer, actual_answer, ollama_score, human_score, created_at
```

---

## Tech stack

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
- [x] Phase 2 — Ingest + BM25 retrieval + streaming chat + live logs
- [x] Phase 3 — Eval pipeline: quiz generation, scoring, human override, history
- [x] Phase 4 — Versioning: save snapshots, deploy, rollback, undeploy
- [ ] Phase 5 — Embeddings + vector search (replace BM25)
