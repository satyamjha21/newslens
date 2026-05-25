# NewsLens — AI News Intelligence Dashboard

> Real-time news aggregation with AI credibility scoring, political lean analysis, rumour detection, and sports intelligence. Built with **FastAPI + Gemini 1.5 Flash + vanilla JS**.

---

## What it does

- Scrapes **35+ RSS feeds** every 10 minutes (BBC, Reuters, Al Jazeera, ESPN, Cricinfo, F1, and more)
- Classifies every headline with **Gemini 1.5 Flash**: genre, political lean, rumour probability, credibility
- Displays a live dashboard with filters: World, Politics, Tech, Markets, Science, Culture, **Sports**
- Sidebar: source bias analysis, lean spectrum, credibility scores per article
- Optional **Tavily agent** for proactive web discovery beyond RSS

---

## Project Structure

```
proj/
├── backend/
│   ├── main.py          # FastAPI app, scheduler, endpoints
│   ├── scraper.py       # RSS feed fetcher (35+ sources)
│   ├── classifier.py    # Gemini classification
│   ├── database.py      # SQLite read/write
│   ├── agent.py         # Tavily web agent (optional)
│   ├── requirements.txt
│   ├── Procfile         # Railway deploy
│   ├── runtime.txt      # Python 3.11
│   └── .env.example
├── frontend/
│   ├── index.html       # Dashboard UI
│   ├── app.js           # All frontend logic
│   └── config.js        # API URL config
├── Dockerfile           # Single-container deploy
├── docker-compose.yml   # API + nginx
└── .gitignore
```

---

## Quick Start (Windows)

```powershell
.\start.ps1
```

Open: **http://127.0.0.1:8000/app/**

Or manually:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env   # add your keys
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

### Environment variables (optional but recommended)

Copy `backend/.env.example` → `backend/.env`:

```
GEMINI_API_KEY=your_key   # article classification (free tier works)
TAVILY_API_KEY=your_key   # agent web discovery (optional)
```

Without keys, RSS still runs with rule-based classification.

---

## Deploy to Railway (recommended — free tier available)

### Step 1 — Push to GitHub

```bash
git init
git add .
git commit -m "initial: NewsLens v1"
git remote add origin https://github.com/YOUR_USERNAME/newslens.git
git push -u origin main
```

### Step 2 — Create Railway project

1. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. Select your `newslens` repo
3. Set **Root Directory** to `backend`
4. Railway auto-detects `Procfile` → uses `uvicorn main:app --host 0.0.0.0 --port $PORT`

### Step 3 — Set environment variables

In Railway dashboard → your service → **Variables**:

```
GEMINI_API_KEY   = your_key
TAVILY_API_KEY   = your_key     (optional)
```

### Step 4 — Update frontend API URL

Edit `frontend/config.js`:
```js
window.NEWS_LENS_API = "https://your-app.up.railway.app";
```

Then deploy the frontend to **GitHub Pages** (see below) or just serve it from Railway (it's already bundled — open `/app/`).

### Step 5 — Open your live dashboard

```
https://your-app.up.railway.app/app/
```

---

## Deploy Frontend to GitHub Pages (optional)

If you want the frontend on a separate free domain:

1. Go to your GitHub repo → **Settings → Pages**
2. Set source to `main` branch → `/frontend` folder
3. Update `frontend/config.js`:
   ```js
   window.NEWS_LENS_API = "https://your-app.up.railway.app";
   ```
4. Your dashboard will be live at `https://YOUR_USERNAME.github.io/newslens/`

---

## API Reference

| Method | Path            | Description                    |
|--------|-----------------|--------------------------------|
| GET    | `/`             | Service status + pipeline info |
| GET    | `/health`       | Health check (Railway uses this)|
| GET    | `/articles`     | Filtered articles              |
| GET    | `/trending`     | Top 5 trending by score        |
| GET    | `/stats`        | Aggregated stats + breakdowns  |
| GET    | `/rumours`      | Rumour articles only           |
| GET    | `/transfers`    | Transfer articles only         |
| GET    | `/sources/bias` | Per-source lean breakdown      |
| POST   | `/fetch`        | Trigger manual RSS fetch       |
| GET    | `/fetch/status` | Fetch pipeline status          |
| GET    | `/docs`         | Interactive Swagger UI         |

### Filter params for `/articles`

```
?genre=Sports&lean=Left&is_rumour=true&is_breaking=true&limit=50
```

---

## Run Tests

```powershell
cd backend
$env:DISABLE_PIPELINES="1"
pytest tests/ -v
```

---

## Tech Stack

| Layer     | Technology                          |
|-----------|-------------------------------------|
| Backend   | Python 3.11, FastAPI, APScheduler   |
| AI        | Gemini 1.5 Flash (Google)           |
| Agent     | Tavily Search API (optional)        |
| Database  | SQLite (persistent, zero-config)    |
| Frontend  | Vanilla JS, Tailwind CSS CDN        |
| Fonts     | Inter, Playfair Display, JetBrains Mono |
| Deploy    | Railway (backend), GitHub Pages (frontend) |
