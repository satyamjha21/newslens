# NewsLens — AI News Intelligence Dashboard

> Real-time news aggregation with **Gemini AI classification**, source trust scoring, political lean analysis, rumour detection, and sports intelligence. Built with **FastAPI + Gemini 1.5 Flash + vanilla JS**.

---

## What it does

- Scrapes **38 RSS feeds** every 10 minutes (BBC, Reuters, Al Jazeera, ESPN, Cricinfo, F1, and more)
- Classifies every headline with **Gemini 1.5 Flash**: genre, political lean, rumour probability, AI summary
- Rate-limited to stay within Gemini free tier: `asyncio.Semaphore(3)` + 1s delay between calls
- Falls back to fast rule-based classifier if no Gemini key is set
- **Source Trust Index**: transparent per-source trust scores (not fake noise)
- **Genre SVG placeholders**: zero external image requests, colour-coded by topic
- Live dashboard with filters: World, Politics, Tech, Markets, Science, Culture, Sports
- Right sidebar: lean spectrum, genre breakdown, trust overview (accessible on mobile via FAB)
- Filters persist across page reloads via localStorage

---

## Project Structure

```
newslens/
├── backend/
│   ├── main.py          # FastAPI app, Gemini-wired ingest, scheduler
│   ├── scraper.py       # RSS feed fetcher with retry logic
│   ├── classifier.py    # Gemini 1.5 Flash classification
│   ├── database.py      # SQLite (persistent DB path via env var)
│   ├── agent.py         # Tavily web agent (optional)
│   ├── requirements.txt
│   ├── Procfile         # Railway deploy
│   ├── railway.json
│   ├── runtime.txt      # Python 3.11
│   └── .env.example
├── frontend/
│   ├── index.html       # Dashboard UI + mobile Analysis Hub
│   ├── api.js           # API client, cache, ingest monitor, search
│   ├── app.js           # All frontend logic
│   └── config.js        # API URL config
├── Dockerfile
├── docker-compose.yml
├── nginx.conf
├── start.sh             # Mac/Linux quick start
├── start.ps1            # Windows quick start
└── .gitignore
```

---

## Quick Start

### Windows

```powershell
.\start.ps1
```

### Mac / Linux

```bash
bash start.sh
```

Open: **http://127.0.0.1:8000/app/**

### Manual setup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env            # then add your keys
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

### Environment variables

| Variable        | Required | Description                                  |
|-----------------|----------|----------------------------------------------|
| `GEMINI_API_KEY` | Optional | Gemini 1.5 Flash (free tier — 15 RPM, 1M tokens/day) |
| `TAVILY_API_KEY` | Optional | Tavily agent for web discovery               |
| `DB_PATH`        | Optional | SQLite path (default: `/data/newslens.db` on Railway) |
| `ADMIN_TOKEN`    | Optional | Protects POST `/fetch` when set       |
| `RATE_LIMIT_ENABLED` | Optional | Set `1` to limit `/fetch` to 5/hour/IP |
| `COLD_START_CAP` | Optional | Max articles on first ingest (default: 50) |
| `LOG_LEVEL`      | Optional | Logging level (default: `INFO`)       |

Without any keys, RSS still runs with fast rule-based classification.

---

## Deploy to Railway

### Step 1 — Push to GitHub

```bash
git init && git add . && git commit -m "NewsLens v4"
git remote add origin https://github.com/YOUR_USERNAME/newslens.git
git push -u origin main
```

### Step 2 — Create Railway project

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub**
2. Select your repo
3. Set **Root Directory** → `backend`
4. Railway detects `Procfile` automatically

### Step 3 — Add environment variables

In Railway dashboard → your service → **Variables**:

```
GEMINI_API_KEY = your_key
TAVILY_API_KEY = your_key   (optional)
DB_PATH        = /data/newslens.db
```

### Step 4 — Attach a persistent volume (prevents DB reset on redeploy)

1. Railway dashboard → your service → **Volumes** tab
2. Click **Add Volume**
3. Mount path: `/data`
4. This is free on Railway's Hobby tier

Without the volume, the SQLite DB resets on every deploy. With it, articles persist.

### Step 5 — Update frontend API URL

Edit `frontend/config.js`:
```js
window.NEWS_LENS_API = "https://your-app.up.railway.app";
```

Then deploy the frontend to **GitHub Pages** (Settings → Pages → `/frontend` folder) or just use the bundled `/app/` route on Railway.

---

## API Reference

| Method | Path               | Description                         |
|--------|--------------------|-------------------------------------|
| GET    | `/`                | Service status + classifier mode    |
| GET    | `/health`          | Health check (DB, feeds, pipeline)  |
| GET    | `/search`          | Full-text search (`?q=keyword`)     |
| GET    | `/articles`        | Filtered articles                   |
| GET    | `/trending`        | Top 5 trending by score             |
| GET    | `/stats`           | Aggregated stats + breakdowns       |
| GET    | `/rumours`         | Rumour articles only                |
| GET    | `/transfers`       | Transfer articles only              |
| GET    | `/sources/bias`    | Per-source lean breakdown           |
| GET    | `/sources/status`  | Feed health (live vs failing)       |
| POST   | `/fetch`           | Trigger manual RSS fetch            |
| GET    | `/fetch/status`    | Fetch pipeline status               |
| GET    | `/docs`            | Interactive Swagger UI              |

### Filter params for `/articles`

```
?genre=Technology&lean=Left&is_rumour=true&is_breaking=true&limit=50
```

---

## Run Tests

```bash
cd backend
DISABLE_PIPELINES=1 pytest tests/ -v
```

---

## Tech Stack

| Layer     | Technology                                   |
|-----------|----------------------------------------------|
| Backend   | Python 3.11, FastAPI, APScheduler            |
| AI        | Gemini 1.5 Flash (Google free tier)          |
| Agent     | Tavily Search API (optional)                 |
| Database  | SQLite (persistent via Railway Volume)       |
| Frontend  | Vanilla JS, Tailwind CSS CDN                 |
| Fonts     | Inter, Playfair Display, JetBrains Mono      |
| Deploy    | Railway (backend), GitHub Pages (frontend)   |

---

## What changed in v4

| Task | Change |
|------|--------|
| 1 | Gemini classifier now wired into ingest pipeline (was dead code) |
| 2 | Fake credibility score replaced with Source Trust Index (transparent lookup table) |
| 3 | Picsum random images replaced with genre-coloured SVG placeholders (zero external requests) |
| 4 | Cold start shows skeleton cards + polls `/fetch/status` every 3s; timeout message at 45s |
| 5 | Auto-refresh is now soft (prepends new cards, never wipes scroll); "N new articles" banner |
| 6 | SQLite DB path fixed for Railway via `DB_PATH` env var + Volume mount instructions |
| 7 | RSS feeds retry up to 3× with exponential backoff; `/sources/status` endpoint added |
| 8 | Analysis Hub accessible on mobile via floating action button + bottom sheet |
| 9 | Active genre/lean filters persist across page reloads via localStorage |
