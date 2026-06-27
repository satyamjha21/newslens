# NewsLens — Run in VSCode Without Errors

Complete step-by-step guide. Follow the order exactly.

---

## Prerequisites

Before opening VSCode, make sure you have:

- **Python 3.10, 3.11, or 3.12** — check with `python --version` in any terminal
  - Download from https://python.org if missing
  - **Windows:** tick "Add Python to PATH" during install — critical
- **VSCode** — https://code.visualstudio.com
- **Git** (optional, only needed to clone) — https://git-scm.com

---

## Step 1 — Open the Project Folder

1. Extract `newslens_v4.zip` somewhere, e.g. `C:\Projects\newslens_refined\`
2. Open VSCode
3. **File → Open Folder** → select the `newslens_refined` folder (the one that contains `backend/` and `frontend/`)

> ⚠️ Open the **folder**, not a file inside it. VSCode needs the workspace root.

---

## Step 2 — Install Recommended Extensions

VSCode will show a popup in the bottom-right corner:
> *"This workspace has extension recommendations. Would you like to install them?"*

Click **Install All**.

If the popup doesn't appear:
`Ctrl+Shift+P` → type `Show Recommended Extensions` → install all from the list.

**Critical extensions** (the others are optional):

| Extension | Purpose |
|---|---|
| **Python** (Microsoft) | Python language support |
| **Debugpy** (Microsoft) | Enables F5 debugging for FastAPI |
| **Black Formatter** | Auto-formats Python on save |
| **Live Server** (Ritwick Dey) | Serves `frontend/` with auto-reload |

After installing, **reload VSCode** when prompted (`Ctrl+Shift+P` → `Reload Window`).

---

## Step 3 — Create the Virtual Environment

Open an integrated terminal: **Terminal → New Terminal** (or `Ctrl+` `` ` ``).

The terminal opens at the project root. Run:

### Windows (PowerShell or CMD)
```powershell
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

### Mac / Linux
```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

This takes 1–2 minutes. You'll see packages downloading. When it finishes, you should see no red errors — only green/white output.

**Common errors at this step:**

| Error | Fix |
|---|---|
| `python: command not found` | Python not installed or not in PATH. Reinstall from python.org with "Add to PATH" checked |
| `python3: command not found` (Windows) | Use `python` instead of `python3` on Windows |
| `pip: command not found` | Use `python -m pip install -r requirements.txt` instead |
| `error: Microsoft Visual C++ required` | Install Visual C++ Build Tools from https://visualstudio.microsoft.com/visual-cpp-build-tools/ |
| `Permission denied` (Mac) | Run `chmod +x .venv/bin/*` then retry |

---

## Step 4 — Select the Python Interpreter

VSCode needs to know which Python to use (the one inside `.venv`, not the system one).

1. Press `Ctrl+Shift+P`
2. Type `Python: Select Interpreter` and press Enter
3. You'll see a list. Pick the one that says:
   ```
   Python 3.x.x ('.venv': venv)   ./backend/.venv/...
   ```

If you don't see `.venv` in the list:
- Click **"Enter interpreter path…"**
- Windows: browse to `backend\.venv\Scripts\python.exe`
- Mac/Linux: browse to `backend/.venv/bin/python3`

> After selecting, the bottom-left of VSCode shows `3.x.x ('.venv': venv)`. That's correct.

---

## Step 5 — Create Your `.env` File

The backend needs a `.env` file. One doesn't ship with the project (it's in `.gitignore`).

In your terminal (still inside `backend/`):

```powershell
# Windows
copy .env.example .env

# Mac/Linux
cp .env.example .env
```

Now open `backend/.env` in VSCode and edit it:

```
GEMINI_API_KEY=your_key_here
TAVILY_API_KEY=your_key_here
```

**Getting keys (both free):**
- **Gemini** (required for AI classification): https://aistudio.google.com → "Get API Key" → copy it
- **Tavily** (optional, enables web agent): https://tavily.com → sign up → copy key

> **No keys?** The app still runs. RSS feeds still fetch every 10 minutes, and articles are classified using built-in rules. You just won't get Gemini AI summaries.

**If `.env` doesn't load:** Make sure the file is named exactly `.env` (not `.env.txt` — Windows sometimes hides the `.txt` extension).

---

## Step 6 — Start the Backend

### Option A — F5 Debug (recommended, lets you set breakpoints)

1. Make sure you're in the **project root** in VSCode (not inside `backend/`)
2. Press **F5**
3. A dropdown appears — select **"🚀 NewsLens Backend (Windows)"** or **"🚀 NewsLens Backend (Mac/Linux)"**
4. The Debug Console / Terminal shows:

```
INFO:     Will watch for changes in these directories: ['.../backend']
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
INFO:     Started reloader process
INFO:     Application startup complete.
[NewsLens] Agent pipeline disabled (no TAVILY_API_KEY)
[RSS] Starting fetch at 2025-...
[RSS] Fetched 280 articles from 38 feeds
[RSS] Done — added 280 new articles
```

### Option B — Terminal

In the terminal (inside `backend/` with `.venv` active):

```powershell
# Windows
.venv\Scripts\uvicorn.exe main:app --reload --host 127.0.0.1 --port 8000

# Mac/Linux
.venv/bin/uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

### Option C — VSCode Task

`Ctrl+Shift+P` → `Tasks: Run Task` → `3️⃣ Start Backend (Windows)` or `(Mac/Linux)`

---

**Backend is running when you see:**
```
INFO:     Application startup complete.
```

Verify it works: open http://127.0.0.1:8000/health in your browser — it should return `{"status":"ok"}`.

**Common errors starting the backend:**

| Error | Fix |
|---|---|
| `ModuleNotFoundError: No module named 'fastapi'` | venv not active or deps not installed. Run `pip install -r requirements.txt` inside `.venv` |
| `Address already in use` / `Port 8000 is in use` | Something else is on port 8000. See port-conflict fix below |
| `Error loading ASGI app: No module named 'main'` | You're not in `backend/` — the `cwd` must be the `backend` directory |
| `FileNotFoundError: .env` | Run `copy .env.example .env` (Windows) or `cp .env.example .env` (Mac/Linux) |
| `.venv\Scripts\uvicorn.exe not found` | Run `pip install -r requirements.txt` first |

**Port 8000 conflict fix:**
```powershell
# Windows — find and kill what's using 8000
netstat -ano | findstr :8000
taskkill /PID <the_PID_number> /F

# Mac/Linux
lsof -ti:8000 | xargs kill -9
```

---

## Step 7 — Open the Frontend

You have two options. **Option A is better for development.**

### Option A — Live Server (auto-reloads on file save)

1. In the Explorer sidebar, find `frontend/index.html`
2. Right-click it → **"Open with Live Server"**
3. Your browser opens at `http://127.0.0.1:5500/frontend/index.html`

The `config.js` file automatically detects port 5500 and points API calls at `http://127.0.0.1:8000`.

> If the dashboard shows "Cannot reach API" — make sure Step 6 is done and the backend terminal shows "Application startup complete."

### Option B — Backend serves the frontend (simplest)

With the backend running, just open:
```
http://127.0.0.1:8000/app/
```

FastAPI serves `frontend/` directly at `/app/`. No separate server needed.

---

## Step 8 — Verify Everything Works

Open http://127.0.0.1:8000/app/ (or the Live Server URL). You should see:

1. **"Connecting"** status in the top-right → changes to **"Live"** within 30 seconds
2. Skeleton cards appear immediately while feeds load
3. Articles appear after ~30 seconds (first fetch takes time)
4. The ticker scrolls headlines at the top
5. The right sidebar shows lean spectrum + genre bars

If articles don't appear after 60 seconds:
- Check the backend terminal for errors
- Manually trigger a fetch: open http://127.0.0.1:8000/docs → POST `/fetch` → Execute

---

## Common VSCode-Specific Issues

### "Import could not be resolved" red squiggles in Python files

This means VSCode is using the wrong interpreter. Fix:
1. `Ctrl+Shift+P` → `Python: Select Interpreter`
2. Pick the `.venv` one (not system Python)
3. Wait a few seconds for IntelliSense to reload

### F5 says "debugpy not found" or "python extension required"

The Debugpy extension isn't installed or loaded:
1. `Ctrl+Shift+P` → `Extensions: Install Extensions`
2. Search `ms-python.debugpy` → Install
3. Reload VSCode (`Ctrl+Shift+P` → `Reload Window`)
4. Try F5 again

### F5 asks for "Select Debug Configuration" but shows nothing

The `launch.json` didn't load. Fix:
1. Make sure you opened the **folder** `newslens_refined/` (not a subfolder)
2. Check that `.vscode/launch.json` exists in the project root
3. `Ctrl+Shift+P` → `Reload Window`

### Black formatter error on save

```
Black: The file is not saved.
```

Black isn't installed in the venv:
```bash
cd backend
.venv\Scripts\pip install black    # Windows
.venv/bin/pip install black        # Mac/Linux
```

### Terminal activates wrong Python (shows system Python instead of .venv)

Close all terminals, then `Ctrl+Shift+P` → `Terminal: Create New Terminal`. The `.venv` should auto-activate (shown by `(.venv)` prefix in the prompt).

If it doesn't:
```powershell
# Windows
backend\.venv\Scripts\Activate.ps1

# Mac/Linux
source backend/.venv/bin/activate
```

### PowerShell execution policy error (Windows only)
```
.venv\Scripts\Activate.ps1 cannot be loaded because running scripts is disabled
```
Fix (run once as admin):
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Live Server "Port 5500 is already in use"

Another Live Server instance is running. Either:
- Click the "Port: 5500" button in the bottom status bar to stop it, then re-open
- Or change the port in `.vscode/settings.json`: `"liveServer.settings.port": 5501`

---

## Running Tests

In a terminal (inside `backend/`, with `.venv` active):

```powershell
# Windows
$env:DISABLE_PIPELINES="1"
.venv\Scripts\python -m pytest tests/ -v --tb=short

# Mac/Linux
DISABLE_PIPELINES=1 .venv/bin/python3 -m pytest tests/ -v --tb=short
```

`DISABLE_PIPELINES=1` prevents the scheduler and RSS fetcher from starting during tests.

Expected output:
```
tests/test_api.py::test_root_returns_ok        PASSED
tests/test_api.py::test_articles_returns_list  PASSED
tests/test_api.py::test_articles_genre_filter  PASSED
tests/test_api.py::test_stats_has_required_keys PASSED
tests/test_api.py::test_ingestion_source_filter PASSED
5 passed in 1.2s
```

---

## Your Daily Workflow

Once set up, every session is just:

1. Open VSCode with the project folder
2. Press **F5** → select Windows or Mac config
3. Wait for "Application startup complete" in the terminal
4. Right-click `frontend/index.html` → **Open with Live Server**
5. Dashboard is live at `http://127.0.0.1:5500/frontend/index.html`

To stop: **Shift+F5** (stops debugger) or `Ctrl+C` in the terminal.

---

## API Explorer (Swagger UI)

With the backend running, open:
```
http://127.0.0.1:8000/docs
```

This gives you a full interactive API explorer — every endpoint, every filter, try them all without writing any code.

---

## Quick Reference

| Action | How |
|---|---|
| Start backend | F5 → select config |
| Stop backend | Shift+F5 or Ctrl+C in terminal |
| Open frontend | Right-click `index.html` → Open with Live Server |
| Trigger RSS fetch | POST http://127.0.0.1:8000/fetch |
| View all articles | GET http://127.0.0.1:8000/articles |
| Filter by genre | GET http://127.0.0.1:8000/articles?genre=Technology |
| View API docs | http://127.0.0.1:8000/docs |
| Run tests | `DISABLE_PIPELINES=1 pytest tests/ -v` |
| Open command palette | Ctrl+Shift+P |
| Select Python interpreter | Ctrl+Shift+P → Python: Select Interpreter |
| Open new terminal | Ctrl+` (backtick) |
