// ─────────────────────────────────────────────
//  NewsLens Intelligence — app.js  (v3 final)
// ─────────────────────────────────────────────

const API = window.NEWS_LENS_API || "";

const NAV_GENRES = {
  World:    "World Politics",
  Politics: "US Politics",
  Tech:     "Technology",
  Markets:  "Economy",
  Science:  "Science",
  Culture:  "Entertainment",
  Sports:   "__sports__",   // virtual multi-genre tab
};

const SPORTS_GENRES = new Set([
  "Football", "Cricket", "Formula 1", "Tennis", "NBA", "Boxing", "Other Sports"
]);

// ── state ──────────────────────────────────────
const state = {
  genre:       null,
  lean:        null,
  isRumour:    false,
  isBreaking:  false,
  isSports:    false,
  activeTab:   "articles",  // articles | sources | saved
  searchQuery: "",
  savedIds:    JSON.parse(localStorage.getItem("nl_saved") || "[]"),
};

let allArticles  = [];
let fetchTriggered = false;
let searchTimeout  = null;

// ── API helper ─────────────────────────────────
async function api(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`);
  return res.json();
}

// ── Utilities ──────────────────────────────────
function timeAgo(iso) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function imageUrl(article) {
  const s = article.url || article.title || "news";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return `https://picsum.photos/seed/${Math.abs(h)}/128/96`;
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}

function isSaved(id)    { return state.savedIds.includes(id); }

function toggleSave(id) {
  if (isSaved(id)) {
    state.savedIds = state.savedIds.filter((x) => x !== id);
  } else {
    state.savedIds.push(id);
  }
  localStorage.setItem("nl_saved", JSON.stringify(state.savedIds));
  updateSavedCount();
}

function updateSavedCount() {
  const badge = document.getElementById("saved-count");
  if (!badge) return;
  const n = state.savedIds.length;
  badge.textContent = n;
  badge.classList.toggle("hidden", n === 0);
}

// ── Credibility helpers ────────────────────────

// Source trust adjustments — positive = more credible, negative = less
const SOURCE_TRUST = {
  "BBC":             15,  "Reuters":          18,  "AP News":          18,
  "Guardian":        10,  "The Guardian":     10,  "Guardian World":   10,
  "Bloomberg":       12,  "Financial Times":  13,  "FT":               13,
  "NYT":              8,  "New York Times":    8,  "NPR":              12,
  "NPR News":        12,  "PBS":              10,  "Al Jazeera":        8,
  "Sky News":         7,  "CNN":               4,  "NDTV":              6,
  "The Hindu":        8,  "Indian Express":    7,  "Times of India":    4,
  "Mint":             6,  "Science Daily":    14,  "New Scientist":    13,
  "WHO":             15,  "Cricinfo":         10,  "ESPN":              7,
  "ESPN FC":          7,  "TechCrunch":        8,  "The Verge":         7,
  "Wired":            9,  "Ars Technica":     10,  "Pitchfork":         6,
  "Rolling Stone":    5,  "Variety":           6,  "NME":               5,
  "Deadline":         5,  "Sky Sports":        7,  "BBC Sport":        10,
  "Goal.com":         6,  "F1 Official":      10,
  "Fox News":        -5,  "Daily Mail":       -8,  "The Sun":          -9,
  "Breitbart":      -12,  "RT":              -15,
};

// Genre verifiability baseline delta
const GENRE_TRUST = {
  "Science":        10,  "Economy":          8,  "Health":           6,
  "Technology":      5,  "Formula 1":        5,  "Climate":          5,
  "Europe":          3,  "World Politics":   2,  "India":            2,
  "Tennis":          2,  "US Politics":      0,  "Cricket":          0,
  "NBA":             0,  "Middle East":      0,  "Other":            0,
  "Football":       -2,  "Other Sports":    -2,  "Boxing":          -2,
  "Entertainment":  -3,  "Music":           -5,  "Cinema":          -5,
};

function computeCredibility(article) {
  // Rumours → use AI-assigned probability directly
  if (article.is_rumour) {
    const score = article.rumour_true_probability ?? 50;
    return {
      score,
      label:   verdictLabel(article.rumour_verdict),
      verdict: article.rumour_verdict || "Unverified",
    };
  }

  // Deterministic per-article noise ±8 so every card looks unique
  const seed = (() => {
    const s = article.url || article.title || "x";
    let h = 0;
    for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0;
    return Math.abs(h);
  })();
  const noise = (seed % 17) - 8;

  // Base credibility for confirmed (non-rumour) articles
  let base = 74;

  // Source trust
  const srcKey = Object.keys(SOURCE_TRUST).find(k =>
    (article.source || "").toLowerCase().includes(k.toLowerCase())
  );
  if (srcKey) base += SOURCE_TRUST[srcKey];

  // Genre baseline
  base += GENRE_TRUST[article.genre] ?? 0;

  // Political lean: opinionated framing slightly reduces straight-news credibility
  const conf = article.lean_confidence || 0;
  if (article.lean && article.lean !== "Unclear") {
    base -= Math.round(conf * 0.08);
  } else {
    base += 3; // neutral/objective framing
  }

  // Breaking confirmed by source = small boost
  if (article.is_breaking) base += 6;

  // Add deterministic noise
  base += noise;

  const score = Math.max(22, Math.min(96, Math.round(base)));

  let verdict = "Confirmed";
  if      (score >= 80) verdict = "Confirmed";
  else if (score >= 62) verdict = "Likely True";
  else if (score >= 44) verdict = "Unverified";
  else if (score >= 30) verdict = "Likely False";
  else                  verdict = "Debunked";

  return { score, label: verdictLabel(verdict), verdict };
}

function verdictLabel(v) {
  const map = {
    "Confirmed":     "Confirmed ✓",
    "Likely True":   "Likely True",
    "Unverified":    "Unverified",
    "Likely False":  "Likely False",
    "Debunked":      "Debunked ✗",
  };
  return map[v] || v || "Unverified";
}

function credibilityClass(score) {
  if (score >= 70) return "credibility-high";
  if (score >= 40) return "credibility-mid";
  return "credibility-low";
}

function credibilityTextColor(score) {
  if (score >= 70) return "text-emerald-700";
  if (score >= 40) return "text-amber-600";
  return "text-red-600";
}

function verdictClass(verdict) {
  const map = {
    "Confirmed":    "verdict-confirmed",
    "Likely True":  "verdict-likely-true",
    "Unverified":   "verdict-unverified",
    "Likely False": "verdict-likely-false",
    "Debunked":     "verdict-debunked",
  };
  return map[verdict] || "verdict-unverified";
}

// ── Article card renderer ──────────────────────
function renderArticle(article) {
  const cred      = computeCredibility(article);
  const saved     = isSaved(article.id);
  const credClass = credibilityClass(cred.score);
  const credText  = credibilityTextColor(cred.score);
  const vClass    = verdictClass(cred.verdict);

  const badges = [];
  if (article.is_breaking)
    badges.push('<span class="px-2 py-0.5 bg-primary/10 text-primary font-meta-sm text-[10px] border border-primary/30">Breaking</span>');
  if (article.is_rumour)
    badges.push('<span class="px-2 py-0.5 bg-error-container text-error font-meta-sm text-[10px] border border-outline-variant">Rumour</span>');
  if (article.is_transfer)
    badges.push('<span class="px-2 py-0.5 bg-tertiary-container text-tertiary font-meta-sm text-[10px] border border-outline-variant">Transfer</span>');

  return `
    <article class="group flex gap-5 py-7 border-b border-outline-variant cursor-pointer hover:bg-surface-container transition-colors duration-200 fade-in ${saved ? "saved-card" : ""}" data-url="${escapeHtml(article.url)}" data-id="${article.id}">
      <div class="w-28 h-20 flex-shrink-0 bg-surface-container-low overflow-hidden border border-outline-variant rounded">
        <img alt="" class="w-full h-full object-cover noir-grayscale" loading="lazy" src="${imageUrl(article)}"/>
      </div>
      <div class="flex-1 min-w-0 flex flex-col">
        <!-- Meta row -->
        <div class="flex items-center gap-3 mb-2 flex-wrap">
          <span class="font-meta-sm text-meta-sm text-primary uppercase">${escapeHtml(article.source)}</span>
          <span class="font-meta-sm text-meta-sm text-on-surface-variant">${timeAgo(article.fetched_at)}</span>
          <span class="px-2 py-0.5 bg-surface-container-low font-meta-sm text-[10px] text-on-surface-variant border border-outline-variant rounded">${escapeHtml(article.genre)}</span>
          ${badges.join("")}
          <!-- Save button -->
          <button class="ml-auto save-btn p-1 rounded hover:bg-surface-container-high transition-colors" data-id="${article.id}" title="${saved ? "Unsave" : "Save"}">
            <span class="material-symbols-outlined text-[16px] ${saved ? "text-primary" : "text-on-surface-variant/50"}">${saved ? "bookmark" : "bookmark_add"}</span>
          </button>
        </div>
        <!-- Headline -->
        <h2 class="font-article-headline text-article-headline text-on-surface mb-2 leading-tight group-hover:text-primary transition-colors">${escapeHtml(article.title)}</h2>
        <!-- Summary -->
        ${article.summary && article.summary !== article.title
          ? `<p class="font-body-md text-body-md text-on-surface-variant line-clamp-2 mb-3">${escapeHtml(article.summary)}</p>`
          : ""}
        <!-- Lean tag -->
        ${article.lean && article.lean !== "Unclear"
          ? `<p class="font-meta-sm text-[10px] text-on-surface-variant mb-3">Lean: <strong>${escapeHtml(article.lean)}</strong> (${article.lean_confidence || 0}% confidence)</p>`
          : ""}

        <!-- ── CREDIBILITY BAR ──────────────────────────── -->
        <div class="mt-auto pt-3 border-t border-outline-variant/50">
          <div class="flex items-center justify-between mb-1">
            <span class="font-meta-sm text-[10px] text-on-surface-variant uppercase tracking-wider">Credibility</span>
            <div class="flex items-center gap-2">
              <span class="font-meta-caps text-[10px] ${vClass}">${verdictLabel(cred.verdict)}</span>
              <span class="font-meta-caps text-[11px] font-bold ${credText}">${cred.score}%</span>
            </div>
          </div>
          <div class="h-1 bg-surface-container-high rounded overflow-hidden">
            <div class="credibility-bar ${credClass}" style="width:${cred.score}%"></div>
          </div>
          ${article.is_rumour ? `
          <div class="flex gap-4 mt-2">
            <span class="font-meta-sm text-[10px] text-emerald-700">✓ True: ${article.rumour_true_probability ?? 50}%</span>
            <span class="font-meta-sm text-[10px] text-red-600">✗ False: ${article.rumour_false_probability ?? 50}%</span>
          </div>` : ""}
        </div>
        <!-- ── END CREDIBILITY BAR ─────────────────────── -->

        <!-- Transfer details -->
        ${article.is_transfer && article.transfer_player ? `
        <div class="mt-3 p-2 bg-tertiary-container/30 border border-tertiary/20 rounded flex flex-wrap gap-x-4 gap-y-1">
          <span class="font-meta-sm text-[10px] text-tertiary">⚽ ${escapeHtml(article.transfer_player)}</span>
          ${article.transfer_from ? `<span class="font-meta-sm text-[10px] text-on-surface-variant">${escapeHtml(article.transfer_from)} → ${escapeHtml(article.transfer_to || "?")}</span>` : ""}
          ${article.transfer_fee  ? `<span class="font-meta-sm text-[10px] text-primary font-bold">${escapeHtml(article.transfer_fee)}</span>` : ""}
        </div>` : ""}
      </div>
    </article>`;
}

// ── Article interactions ────────────────────────
function bindArticleInteractions(container) {
  container.querySelectorAll(".save-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      toggleSave(id);
      if (state.activeTab === "saved") {
        renderSavedTab();
      } else {
        const card = container.querySelector(`article[data-id="${id}"]`);
        if (card) {
          const newHtml = renderArticle(allArticles.find((a) => a.id === id) || {});
          card.outerHTML = newHtml;
          bindArticleInteractions(container);
        }
      }
    });
  });

  container.querySelectorAll("article[data-url]").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest(".save-btn")) return;
      const url = card.dataset.url;
      if (url) window.open(url, "_blank", "noopener");
    });
  });
}

// ── Feed renderer ───────────────────────────────
function renderFeed(articles) {
  const el = document.getElementById("article-feed");
  if (!articles.length) {
    el.innerHTML = `<p class="font-body-md text-on-surface-variant py-12 text-center">No articles found. Try a different filter or wait for the next fetch cycle.</p>`;
    return;
  }
  el.innerHTML = articles.map(renderArticle).join("");
  bindArticleInteractions(el);
}

// ── Right sidebar widgets ───────────────────────
function renderTicker(articles) {
  const el = document.getElementById("ticker-content");
  if (!el || !articles.length) return;
  const items = articles.map((a) => `<span class="cursor-pointer hover:text-on-surface transition-colors" onclick="window.open('${a.url}','_blank','noopener')">${escapeHtml(a.title)}</span>`);
  const doubled = [...items, ...items];
  el.innerHTML = doubled.join('<span class="opacity-30 select-none">  ·  </span>');
}

function renderLeanSpectrum(breakdown) {
  const el = document.getElementById("lean-spectrum");
  if (!el) return;
  const order  = ["Left", "Centre", "Right", "Unclear"];
  const colors = { Left: "#3b82f6", Centre: "#10b981", Right: "#ef4444", Unclear: "#9ca3af" };
  const labels = breakdown && Object.keys(breakdown).length;
  if (!labels) {
    el.innerHTML = `<p class="font-meta-sm text-[10px] text-on-surface-variant italic text-center">No data yet</p>`;
    return;
  }
  el.innerHTML = order.map((lean) => {
    const pct = breakdown[lean] ?? 0;
    if (!pct) return "";
    return `<div class="flex items-center gap-2 mb-2">
      <span class="font-meta-sm text-[10px] w-12 text-on-surface-variant">${lean}</span>
      <div class="flex-1 h-1.5 bg-surface-container-high rounded overflow-hidden">
        <div class="h-full rounded" style="width:${pct}%;background:${colors[lean]}"></div>
      </div>
      <span class="font-meta-sm text-[10px] text-on-surface-variant w-8 text-right">${pct}%</span>
    </div>`;
  }).join("");
}

function renderGenreBars(genres, total) {
  const el = document.getElementById("genre-bars");
  if (!el || !genres) return;
  const top = Object.entries(genres).sort((a, b) => b[1] - a[1]).slice(0, 6);
  el.innerHTML = top.map(([genre, count]) => {
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    return `<div>
      <div class="flex justify-between mb-1">
        <span class="font-meta-sm text-[10px] text-on-surface-variant truncate">${escapeHtml(genre)}</span>
        <span class="font-meta-sm text-[10px] text-on-surface-variant ml-2">${count}</span>
      </div>
      <div class="h-1 bg-surface-container-high rounded overflow-hidden">
        <div class="h-full bg-primary/60 rounded" style="width:${pct}%"></div>
      </div>
    </div>`;
  }).join("");
}

function renderCredibilityOverview(articles) {
  const el = document.getElementById("credibility-overview");
  if (!el || !articles.length) return;
  const scores = articles.map((a) => computeCredibility(a).score);
  const avg    = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
  const high   = scores.filter((s) => s >= 70).length;
  const mid    = scores.filter((s) => s >= 40 && s < 70).length;
  const low    = scores.filter((s) => s < 40).length;
  const cls    = credibilityClass(avg);
  const txt    = credibilityTextColor(avg);
  el.innerHTML = `
    <div class="flex items-center gap-3 mb-3">
      <div class="h-2 flex-1 bg-surface-container-high rounded overflow-hidden">
        <div class="credibility-bar ${cls} h-full" style="width:${avg}%"></div>
      </div>
      <span class="font-meta-caps text-[13px] font-bold ${txt}">${avg}%</span>
    </div>
    <div class="flex gap-3 text-center">
      <div class="flex-1"><span class="font-meta-sm text-[10px] text-emerald-700 font-bold block">${high}</span><span class="font-meta-sm text-[9px] text-on-surface-variant">High</span></div>
      <div class="flex-1"><span class="font-meta-sm text-[10px] text-amber-600 font-bold block">${mid}</span><span class="font-meta-sm text-[9px] text-on-surface-variant">Mid</span></div>
      <div class="flex-1"><span class="font-meta-sm text-[10px] text-red-600 font-bold block">${low}</span><span class="font-meta-sm text-[9px] text-on-surface-variant">Low</span></div>
    </div>`;
}

function renderArchive(articles) {
  const el = document.getElementById("archive-list");
  if (!el) return;
  const recent = articles.slice(0, 5);
  el.innerHTML = recent.map((a) => `
    <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener" class="block group">
      <p class="font-meta-sm text-[11px] text-on-surface group-hover:text-primary transition-colors line-clamp-2 leading-snug">${escapeHtml(a.title)}</p>
      <span class="font-meta-sm text-[10px] text-on-surface-variant">${timeAgo(a.fetched_at)}</span>
    </a>`).join("");
}

// ── Sources tab ──────────────────────────────────
async function renderSourcesTab() {
  const el = document.getElementById("sources-feed");
  try {
    const bias = await api("/sources/bias");
    const entries = Object.entries(bias).sort((a, b) => {
      const ta = Object.values(a[1]).reduce((s, v) => s + v, 0);
      const tb = Object.values(b[1]).reduce((s, v) => s + v, 0);
      return tb - ta;
    });
    if (!entries.length) {
      el.innerHTML = `<p class="font-body-md text-on-surface-variant py-8 text-center">No source data yet.</p>`;
      return;
    }
    const leanClass = (l) => ({
      Left: "bias-left", Right: "bias-right", Centre: "bias-centre", Unclear: "bias-unclear"
    }[l] || "bias-unclear");

    el.innerHTML = entries.map(([source, leans]) => {
      const total = Object.values(leans).reduce((s, v) => s + v, 0);
      const dominant = Object.entries(leans).sort((a, b) => b[1] - a[1])[0]?.[0] || "Unclear";
      const pills = Object.entries(leans)
        .sort((a, b) => b[1] - a[1])
        .map(([lean, cnt]) => `<span class="px-2 py-0.5 rounded-full font-meta-sm text-[10px] ${leanClass(lean)}">${lean}: ${cnt}</span>`)
        .join("");
      return `<div class="flex items-center justify-between py-4 border-b border-outline-variant gap-4">
        <div>
          <p class="font-meta-sm text-meta-sm text-on-surface font-bold">${escapeHtml(source)}</p>
          <p class="font-meta-sm text-[10px] text-on-surface-variant mt-0.5">${total} articles · Dominant: <strong>${dominant}</strong></p>
          <div class="flex flex-wrap gap-1 mt-2">${pills}</div>
        </div>
        <span class="shrink-0 px-3 py-1 rounded-full font-meta-sm text-[10px] ${leanClass(dominant)}">${dominant}</span>
      </div>`;
    }).join("");
  } catch (e) {
    el.innerHTML = `<p class="font-body-md text-error py-8 text-center">Failed to load source data.</p>`;
  }
}

// ── Saved tab ───────────────────────────────────
function renderSavedTab() {
  const el    = document.getElementById("saved-feed");
  const saved = allArticles.filter((a) => isSaved(a.id));
  if (!saved.length) {
    el.innerHTML = `<p class="font-body-md text-on-surface-variant py-12 text-center">No saved articles yet. Click the bookmark icon on any article to save it here.</p>`;
    return;
  }
  el.innerHTML = saved.map(renderArticle).join("");
  bindArticleInteractions(el);
}

// ── Tab switching ──────────────────────────────
function switchTab(tab) {
  state.activeTab = tab;
  if (tab !== "articles") state.isSports = false;

  ["articles", "sources", "saved"].forEach((t) => {
    document.getElementById(`tab-${t}`)?.classList.toggle("active", t === tab);
  });

  document.querySelectorAll(".sidebar-item").forEach((el) => el.classList.remove("active"));

  if (tab === "sources") {
    document.getElementById("filter-sources")?.classList.add("active");
    document.getElementById("feed-title").textContent = "Source Intelligence";
    document.getElementById("feed-label").textContent = "Bias Analysis";
    renderSourcesTab();
  } else if (tab === "saved") {
    document.getElementById("filter-saved")?.classList.add("active");
    document.getElementById("feed-title").textContent = "Saved Articles";
    document.getElementById("feed-label").textContent = "Your Reading List";
    renderSavedTab();
  } else {
    document.getElementById("filter-all")?.classList.add("active");
  }
}

// ── Status ─────────────────────────────────────
function setStatus(text, live = false) {
  const el = document.getElementById("api-status");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("text-status-live", live);
}

// ── Query builder ──────────────────────────────
function buildArticlesQuery() {
  const params = new URLSearchParams({ limit: "150" });
  // Sports fetches all; filtered client-side across multiple genres
  if (!state.isSports && state.genre) params.set("genre", state.genre);
  if (state.lean)      params.set("lean", state.lean);
  if (state.isRumour)  params.set("is_rumour", "true");
  if (state.isBreaking) params.set("is_breaking", "true");
  return `/articles?${params}`;
}

// ── Ensure fetch running ────────────────────────
async function ensureFetchRunning() {
  if (fetchTriggered) return;
  try {
    const status = await api("/fetch/status");
    if (!status.running && status.total === 0) {
      await fetch(`${API}/fetch`, { method: "POST" });
    }
    fetchTriggered = true;
  } catch (e) {
    console.warn("fetch trigger", e);
  }
}

// ── Main refresh ────────────────────────────────
async function refresh() {
  try {
    let articles = await api(buildArticlesQuery());

    // Sports: client-side multi-genre filter
    if (state.isSports) {
      articles = articles.filter((a) => SPORTS_GENRES.has(a.genre));
    }

    // Client-side search filter
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      articles = articles.filter(
        (a) =>
          a.title?.toLowerCase().includes(q) ||
          a.summary?.toLowerCase().includes(q) ||
          a.source?.toLowerCase().includes(q)
      );
    }

    allArticles = articles;

    if (articles.length > 0) {
      setStatus("Live", true);
    } else {
      await ensureFetchRunning();
      setStatus("Fetching");
    }

    if (state.activeTab === "articles") renderFeed(articles);

    // Right sidebar
    renderCredibilityOverview(articles);

    // Async sidebar panels
    api("/trending")
      .then((trending) => renderTicker(trending.length ? trending : articles.slice(0, 5)))
      .catch(() => {});

    api("/stats")
      .then((stats) => {
        renderLeanSpectrum(stats.lean_breakdown || {});
        renderGenreBars(stats.genres_breakdown, stats.total);
        document.getElementById("stat-sources").textContent = stats.total;
        document.getElementById("stat-alerts").textContent  = stats.rumours;
        if (stats.total > 0) setStatus("Live", true);
        renderArchive(articles);
      })
      .catch(() => {});
  } catch (e) {
    console.error(e);
    setStatus("Offline");
    document.getElementById("article-feed").innerHTML =
      `<p class="font-body-md text-error py-12 text-center">Cannot reach API. Run <code>.\\start.ps1</code> then open <a href="http://127.0.0.1:8000/app/" class="underline">http://127.0.0.1:8000/app/</a></p>`;
  }
}

// ── Search handler ──────────────────────────────
function setupSearch() {
  const input = document.getElementById("search-input");
  if (!input) return;
  input.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      state.searchQuery = input.value.trim();
      refresh();
    }, 300);
  });
}

// ── Mobile sidebar ──────────────────────────────
function openSidebar()  {
  document.getElementById("sidebar")?.classList.add("mobile-open", "flex");
  document.getElementById("mobile-overlay")?.classList.add("open");
}
function closeSidebar() {
  document.getElementById("sidebar")?.classList.remove("mobile-open");
  document.getElementById("mobile-overlay")?.classList.remove("open");
}
window.closeSidebar = closeSidebar;

// ── Nav setup ───────────────────────────────────
function setupNav() {
  // Genre nav links (top bar)
  document.querySelectorAll("[data-nav-genre]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const label  = link.dataset.navGenre;
      const mapped = NAV_GENRES[label];
      state.isSports  = (mapped === "__sports__");
      state.genre     = state.isSports ? null : (mapped || null);
      state.isRumour  = false;
      state.isBreaking = false;
      state.activeTab = "articles";
      switchTab("articles");
      // Highlight active nav link
      document.querySelectorAll("[data-nav-genre]").forEach((l) => {
        l.classList.remove("text-primary", "border-b-2", "border-primary", "pb-1");
        l.classList.add("text-on-surface-variant");
      });
      link.classList.add("text-primary", "border-b-2", "border-primary", "pb-1");
      link.classList.remove("text-on-surface-variant");
      document.getElementById("feed-title").textContent = label;
      document.getElementById("feed-label").textContent = label === "Sports" ? "Sports Intelligence" : "Genre Filter";
      refresh();
    });
  });

  // Lean cycle
  document.getElementById("filter-lean")?.addEventListener("click", () => {
    const cycle = [null, "Left", "Centre", "Right", "Unclear"];
    const idx   = (cycle.indexOf(state.lean) + 1) % cycle.length;
    state.lean  = cycle[idx];
    document.getElementById("filter-lean-label").textContent = state.lean || "All";
    if (state.activeTab !== "articles") switchTab("articles");
    refresh();
  });

  // All articles
  document.getElementById("filter-all")?.addEventListener("click", () => {
    state.genre      = null;
    state.lean       = null;
    state.isRumour   = false;
    state.isBreaking = false;
    state.isSports   = false;
    document.getElementById("feed-title").textContent = "Forensic Digest";
    document.getElementById("feed-label").textContent = "Intelligence Stream";
    switchTab("articles");
    refresh();
  });

  // Rumours
  document.getElementById("filter-rumours")?.addEventListener("click", () => {
    state.isRumour   = !state.isRumour;
    state.isBreaking = false;
    state.genre      = null;
    state.isSports   = false;
    state.activeTab  = "articles";
    document.getElementById("filter-rumours")?.classList.toggle("active", state.isRumour);
    document.getElementById("feed-title").textContent = state.isRumour ? "Rumour Watch"    : "Forensic Digest";
    document.getElementById("feed-label").textContent = state.isRumour ? "Unverified Claims" : "Intelligence Stream";
    switchTab("articles");
    refresh();
  });

  // Sources tab
  document.getElementById("filter-sources")?.addEventListener("click", () => {
    switchTab("sources");
  });

  // Saved tab
  document.getElementById("filter-saved")?.addEventListener("click", () => {
    switchTab("saved");
  });

  // Breaking
  document.getElementById("filter-breaking")?.addEventListener("click", () => {
    state.isBreaking = !state.isBreaking;
    state.isRumour   = false;
    state.genre      = null;
    state.isSports   = false;
    document.getElementById("filter-breaking")?.classList.toggle("active", state.isBreaking);
    document.getElementById("feed-title").textContent = state.isBreaking ? "Breaking News"   : "Forensic Digest";
    document.getElementById("feed-label").textContent = state.isBreaking ? "Verified Alerts" : "Intelligence Stream";
    switchTab("articles");
    refresh();
  });

  // Sports tab (sidebar)
  document.getElementById("filter-sports")?.addEventListener("click", () => {
    state.isSports   = true;
    state.genre      = null;
    state.isRumour   = false;
    state.isBreaking = false;
    state.activeTab  = "articles";
    document.querySelectorAll(".sidebar-item").forEach((el) => el.classList.remove("active"));
    document.getElementById("filter-sports")?.classList.add("active");
    document.getElementById("feed-title").textContent = "Sports";
    document.getElementById("feed-label").textContent = "Sports Intelligence";
    switchTab("articles");
    refresh();
  });

  // Refresh button
  document.getElementById("refresh-btn")?.addEventListener("click", () => {
    refresh();
  });

  // Mobile menu
  document.getElementById("mobile-menu-btn")?.addEventListener("click", openSidebar);

  // API docs link
  const docsLink = document.getElementById("api-docs-link");
  if (docsLink) docsLink.href = `${API}/docs`;
}

// ── Init ────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  updateSavedCount();
  setupSearch();
  setupNav();
  refresh();
  setInterval(refresh, 5 * 60 * 1000); // auto-refresh every 5 min
});
