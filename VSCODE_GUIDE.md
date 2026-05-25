# NewsLens — Complete VSCode Setup & Run Guide

## What's in the Project

```
newslens/
├── .vscode/
│   ├── settings.json      ← Python interpreter, formatting, Live Server config
│   ├── launch.json        ← F5 debug configs for FastAPI + pytest
│   ├── tasks.json         ← One-click setup, start, test tasks
│   └── extensions.json    ← Recommended extensions list
├── backend/
│   ├── main.py            ← FastAPI app, routes, scheduler
│   ├── database.py        ← SQLite layer
│   ├── classifier.py      ← Gemini AI classifier
│   ├── scraper.py         ← RSS feed scraper
│   ├── agent.py           ← Tavily deep-search agent (optional)
│   ├── requirements.txt   ← Python deps
│   ├── .env.example       ← Copy this to .env and add your keys
│   └── tests/
│       └── test_api.py
├── frontend/
│   ├── index.html         ← Main dashboard UI
│   ├── app.js             ← All frontend logic
│   └── config.js          ← API URL auto-detection
├── start.ps1              ← Windows one-click launcher
├── start.sh               ← Mac/Linux one-click launcher
└── docker-compose.yml     ← Optional Docker full-stack
```

---

## Step 1 — Install VSCode Extensions

When you open the folder, VSCode will show a popup:
> "This workspace has extension recommendations. Do you want to install them?"

Click **Install All**. This installs:

| Extension | Why |
|---|---|
| Python (Microsoft) | Python language support, IntelliSense |
| Debugpy | Run/debug FastAPI with F5 |
| Black Formatter | Auto-formats Python on save |
| Live Server | Serves the frontend at localhost:5500 |
| Thunder Client | Test API endpoints inside VSCode |
| GitLens | Better Git history |
| SQLTools + SQLite driver | Browse the database visually |
| Tailwind CSS IntelliSense | Autocomplete in HTML |

If the popup doesn't appear: `Ctrl+Shift+P` → **"Extensions: Show Recommended Extensions"** → install all.

---

## Step 2 — Set Up the Backend

### 2a. Open an Integrated Terminal

`Ctrl+` `` ` `` (backtick) to open terminal, or **Terminal → New Terminal**

### 2b. Navigate to backend and create the virtual environment

**Windows:**
```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

**Mac / Linux:**
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

You'll see `(.venv)` appear in the terminal prompt. This means it's activated.

### 2c. Select the Python Interpreter

`Ctrl+Shift+P` → type **"Python: Select Interpreter"** → choose the one that says:
```
Python 3.x.x  ('.venv': venv)  ./backend/.venv/...
```

---

## Step 3 — Add Your API Keys

1. In the file explorer, open `backend/`
2. Duplicate `.env.example` and rename it to `.env`

   **Or in terminal:**
   ```bash
   # Windows
   copy .env.example .env

   # Mac/Linux
   cp .env.example .env
   ```

3. Open `backend/.env` and fill in:
   ```
   GEMINI_API_KEY=your_key_here
   TAVILY_API_KEY=your_key_here   ← optional
   ```

**Get keys free:**
- Gemini: https://aistudio.google.com → "Get API Key"
- Tavily: https://tavily.com → free tier (enables deep news verification)

> **Without keys:** The app still works using the built-in rule-based classifier. You just won't get AI-powered summaries or verification.

---

## Step 4 — Run the Backend

### Option A: Use F5 (Recommended)

1. Make sure you're in the project root (not inside `backend/`)
2. Press **F5** or go to **Run → Start Debugging**
3. Select **"🚀 Run Backend (FastAPI)"** from the dropdown
4. The terminal shows:
   ```
   INFO:     Uvicorn running on http://127.0.0.1:8000
   INFO:     Application startup complete.
   [RSS] Starting fetch...
   ```

### Option B: Use the Terminal

```bash
# Inside backend/, with venv active:
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

### Option C: One-Click Scripts

```powershell
# Windows — from project root:
.\start.ps1

# Mac/Linux:
bash start.sh
```

---

## Step 5 — Run the Frontend

### Option A: Live Server (Best for development — auto-reloads)

1. In the Explorer sidebar, right-click `frontend/index.html`
2. Click **"Open with Live Server"**
3. Browser opens at `http://127.0.0.1:5500/frontend/index.html`

The `config.js` auto-detects that you're on port 5500 and points the API at `http://127.0.0.1:8000`.

### Option B: Use the backend's built-in static file server

Just open: **http://127.0.0.1:8000/app/**

The FastAPI backend serves the `frontend/` folder at `/app/`. No separate server needed.

---

## Step 6 — Test the API with Thunder Client

Thunder Client is like Postman but inside VSCode.

1. Click the thunder bolt icon in the left sidebar
2. Click **"New Request"**
3. Try these endpoints:

| Method | URL | Description |
|---|---|---|
| GET | `http://127.0.0.1:8000/health` | Check API is running |
| GET | `http://127.0.0.1:8000/articles` | All articles |
| GET | `http://127.0.0.1:8000/articles?is_rumour=true` | Only rumours |
| GET | `http://127.0.0.1:8000/articles?genre=Technology` | Filter by genre |
| GET | `http://127.0.0.1:8000/articles?is_breaking=true` | Breaking news |
| GET | `http://127.0.0.1:8000/stats` | Dashboard stats |
| GET | `http://127.0.0.1:8000/sources/bias` | Source bias analysis |
| GET | `http://127.0.0.1:8000/rumours` | All rumours with probabilities |
| POST | `http://127.0.0.1:8000/fetch` | Manually trigger RSS fetch |
| GET | `http://127.0.0.1:8000/docs` | Auto-generated Swagger UI |

---

## Step 7 — Browse the Database

1. Click the **SQLTools** icon in the left sidebar (database cylinder icon)
2. Click **"Add New Connection"**
3. Select **SQLite**
4. Set the path to: `./backend/newslens.db`
5. Click **Test Connection** → **Save**
6. Expand the connection → **Tables → articles** → right-click → **Select Top 50**

You can now run SQL queries live, e.g.:
```sql
SELECT title, lean, rumour_true_probability, rumour_verdict
FROM articles
WHERE is_rumour = 1
ORDER BY fetched_at DESC
LIMIT 20;
```

---

## Quick Reference — Key Shortcuts

| Action | Shortcut |
|---|---|
| Open terminal | Ctrl + ` |
| Run / Debug (F5) | F5 |
| Stop debug | Shift + F5 |
| Command palette | Ctrl+Shift+P |
| Toggle sidebar | Ctrl+B |
| Format document | Shift+Alt+F |
| Find in files | Ctrl+Shift+F |
| Open settings | Ctrl+, |

---

## Troubleshooting

### "Cannot reach API" on the dashboard
- Make sure the backend is running (`uvicorn` started in terminal or via F5)
- Check terminal for errors — usually a missing package or wrong Python version

### "ModuleNotFoundError" when starting backend
```bash
# Make sure venv is active and deps are installed:
cd backend
.venv\Scripts\activate      # Windows
source .venv/bin/activate   # Mac/Linux
pip install -r requirements.txt
```

### Python interpreter not found in VSCode
`Ctrl+Shift+P` → "Python: Select Interpreter" → browse to `backend/.venv/Scripts/python.exe` (Windows) or `backend/.venv/bin/python3` (Mac/Linux)

### Live Server shows wrong API URL
The `config.js` auto-detects the port. If it's still wrong, add this to the URL:
```
http://127.0.0.1:5500/frontend/index.html?api=http://127.0.0.1:8000
```

### Port 8000 already in use
```bash
# Windows
netstat -ano | findstr :8000
taskkill /PID <PID_NUMBER> /F

# Mac/Linux
lsof -ti:8000 | xargs kill
```

### No articles showing up
The RSS feed auto-fetches on startup (after 2 seconds). If it's empty:
```
POST http://127.0.0.1:8000/fetch
```
Wait ~30 seconds, then refresh the dashboard.

---

## Workflow Summary

```
1. Open folder in VSCode
2. Install recommended extensions
3. cd backend → python -m venv .venv → pip install -r requirements.txt
4. cp .env.example .env → add GEMINI_API_KEY
5. Press F5 → select "Run Backend"
6. Right-click frontend/index.html → Open with Live Server
7. Dashboard opens at http://127.0.0.1:5500
```

That's it. Backend auto-fetches RSS feeds on startup and every 10 minutes.
