// ─────────────────────────────────────────────
//  NewsLens Intelligence — app.js  (v5 + api.js)
// ─────────────────────────────────────────────

const { client, IngestMonitor, SearchDebouncer, LoadingStateManager, ErrorHandler } =
  window.NewsLensAPI;

const API = client.baseUrl;

const feedLoader = new LoadingStateManager("article-feed", {
  skeletonClass: "skeleton-card bg-surface-container-high rounded-xl h-32 mb-4 animate-pulse",
});

const ingestMonitor = new IngestMonitor(client, {
  panelId: "ingestProgress",
  barId: "ingestProgressBar",
  labelId: "ingestEta",
});

ingestMonitor.on("complete", () => refresh({ skipCache: true }));
ingestMonitor.on("error", (err) => console.warn("[Ingest]", err.message || err));

let _lastIngestDbTotal = 0;
ingestMonitor.on("progress", (status) => {
  if (status.total > _lastIngestDbTotal) {
    _lastIngestDbTotal = status.total;
    _coldStartResolved = true;
    refresh({ skipCache: true });
  }
});

feedLoader.onRetry(() => refresh({ skipCache: true }));

let searchDebouncer = null;

const NAV_GENRES = {
  World:    "World Politics",
  Politics: "US Politics",
  Tech:     "Technology",
  Markets:  "Economy",
  Science:  "Science",
  Culture:  "Entertainment",
  Sports:   "__sports__",
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
  activeTab:   "articles",
  searchQuery: "",
  savedIds:    JSON.parse(localStorage.getItem("nl_saved") || "[]"),
};

let allArticles    = [];
let fetchTriggered = false;

// Task 5: track displayed URLs for soft refresh
const displayedUrls = new Set();

// ── API helper (delegates to APIClient) ────────
async function api(path, opts = {}) {
  return client.get(path, opts);
}

function showApiError(containerId, error) {
  const parsed = ErrorHandler.parse(error);
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<p class="font-body-md text-error py-12 text-center">${escapeHtml(parsed.message)}</p>`;
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

// ── TASK 2: Source Trust Index ─────────────────
// Transparent lookup table — not noise-based fake scores.
// Based on editorial standards, fact-checking record, and correction policies.
const SOURCE_TRUST = {
  "Reuters":               92,
  "AP":                    91,
  "BBC World":             90,
  "BBC Sport":             88,
  "BBC Sport Football":    88,
  "Financial Times":       88,
  "NPR News":              87,
  "Bloomberg":             85,
  "Cricinfo":              84,
  "Science Daily":         84,
  "Al Jazeera":            83,
  "ESPN":                  82,
  "ESPN FC":               82,
  "New Scientist":         82,
  "The Guardian":          80,
  "Guardian World":        80,
  "Sky Sports Football":   80,
  "F1 Official":           86,
  "The Hindu":             79,
  "Wired":                 78,
  "Ars Technica":          80,
  "The Verge":             77,
  "WebMD":                 76,
  "TechCrunch":            76,
  "Indian Express":        75,
  "Variety":               75,
  "The Hollywood Reporter":75,
  "NDTV":                  74,
  "Deadline Hollywood":    74,
  "Mint":                  74,
  "Rolling Stone":         72,
  "Goal.com":              72,
  "Times of India":        72,
  "Pitchfork":             71,
  "NME":                   68,
  "Fox News":              58,
  "_default":              70
};

function getSourceTrust(sourceName) {
  return SOURCE_TRUST[sourceName] ?? SOURCE_TRUST["_default"];
}

// ── TASK 3: Genre-coloured SVG placeholder images ──
// Zero external requests — pure data URI SVGs
const GENRE_COLORS = {
  "Football":       "#1a472a",
  "Cricket":        "#2d5016",
  "Technology":     "#0f172a",
  "Economy":        "#1e1b4b",
  "Science":        "#0c4a6e",
  "Health":         "#14532d",
  "Entertainment":  "#4a044e",
  "India":          "#7c2d12",
  "World Politics": "#1c1917",
  "Formula 1":      "#450a0a",
  "Tennis":         "#064e3b",
  "NBA":            "#1e3a5f",
  "US Politics":    "#312e81",
  "Middle East":    "#451a03",
  "Climate":        "#052e16",
  "Music":          "#3b0764",
  "Cinema":         "#1e1b4b",
  "Boxing":         "#450a0a",
  "Europe":         "#1e3a5f",
  "Other Sports":   "#18181b",
  "Other":          "#18181b"
};

function getPlaceholderSVG(genre, title) {
  const color    = GENRE_COLORS[genre] || GENRE_COLORS["Other"];
  const words    = (title || genre || "NL").trim().split(/\s+/);
  const initials = words.slice(0, 2).map(w => (w[0] || "")).join("").toUpperCase() || "NL";
  const label    = genre || "Other";
  return (
    "data:image/svg+xml," +
    encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='200' viewBox='0 0 400 200'>` +
      `<rect width='400' height='200' fill='${color}'/>` +
      `<text x='200' y='95' font-family='Inter,sans-serif' font-size='52' fill='white' text-anchor='middle' opacity='0.22'>${initials}</text>` +
      `<text x='200' y='132' font-family='Inter,sans-serif' font-size='13' fill='white' text-anchor='middle' opacity='0.40' letter-spacing='2'>${label.toUpperCase()}</text>` +
      `</svg>`
    )
  );
}

// ── Trust verdict helpers ──────────────────────
function verdictForTrust(score) {
  if (score >= 88) return "Highly Trusted";
  if (score >= 80) return "Trusted";
  if (score >= 72) return "Generally Reliable";
  if (score >= 62) return "Mixed Record";
  return "Low Trust";
}

function trustClass(score) {
  if (score >= 75) return "credibility-high";
  if (score >= 60) return "credibility-mid";
  return "credibility-low";
}

function trustTextColor(score) {
  if (score >= 75) return "text-emerald-700";
  if (score >= 60) return "text-amber-600";
  return "text-red-600";
}

// Rumour verdict helpers
function verdictLabel(v) {
  const map = {
    "Confirmed":    "Confirmed ✓",
    "Likely True":  "Likely True",
    "Unverified":   "Unverified",
    "Likely False": "Likely False",
    "Debunked":     "Debunked ✗",
  };
  return map[v] || v || "Unverified";
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
  const trust   = getSourceTrust(article.source);
  const saved   = isSaved(article.id);
  const tClass  = trustClass(trust);
  const tText   = trustTextColor(trust);
  const verdict = verdictForTrust(trust);

  const isRumour      = !!article.is_rumour;
  const rumourVerdict = isRumour ? (article.rumour_verdict || "Unverified") : null;
  const vClass        = isRumour ? verdictClass(rumourVerdict) : "";

  const badges = [];
  if (article.is_breaking)
    badges.push('<span class="px-2 py-0.5 bg-primary/10 text-primary font-meta-sm text-[10px] border border-primary/30">Breaking</span>');
  if (article.is_rumour)
    badges.push('<span class="px-2 py-0.5 bg-error-container text-error font-meta-sm text-[10px] border border-outline-variant">Rumour</span>');
  if (article.is_transfer)
    badges.push('<span class="px-2 py-0.5 bg-tertiary-container text-tertiary font-meta-sm text-[10px] border border-outline-variant">Transfer</span>');

  const imgSrc = getPlaceholderSVG(article.genre, article.title);

  return `
    <article class="group flex gap-5 py-7 border-b border-outline-variant cursor-pointer hover:bg-surface-container transition-colors duration-200 fade-in${saved ? " saved-card" : ""}" data-url="${escapeHtml(article.url)}" data-id="${article.id}">
      <div class="w-28 h-20 flex-shrink-0 bg-surface-container-low overflow-hidden border border-outline-variant rounded">
        <img alt="${escapeHtml(article.genre)}" class="article-thumb w-full h-full object-cover" loading="lazy" src="${imgSrc}"/>
      </div>
      <div class="flex-1 min-w-0 flex flex-col">
        <!-- Meta row -->
        <div class="flex items-center gap-3 mb-2 flex-wrap">
          <span class="font-meta-sm text-meta-sm text-primary uppercase">${escapeHtml(article.source)}</span>
          <span class="font-meta-sm text-meta-sm text-on-surface-variant">${timeAgo(article.fetched_at)}</span>
          <span class="px-2 py-0.5 bg-surface-container-low font-meta-sm text-[10px] text-on-surface-variant border border-outline-variant rounded">${escapeHtml(article.genre)}</span>
          ${badges.join("")}
          <button class="ml-auto save-btn p-1 rounded hover:bg-surface-container-high transition-colors" data-id="${article.id}" title="${saved ? "Unsave" : "Save"}">
            <span class="material-symbols-outlined text-[16px] ${saved ? "text-primary" : "text-on-surface-variant/50"}">${saved ? "bookmark" : "bookmark_add"}</span>
          </button>
        </div>
        <!-- Headline -->
        <h2 class="font-article-headline text-article-headline text-on-surface mb-2 leading-tight group-hover:text-primary transition-colors">${escapeHtml(article.title)}</h2>
        <!-- Summary (from Gemini when available) -->
        ${article.summary && article.summary !== article.title
          ? `<p class="font-body-md text-body-md text-on-surface-variant line-clamp-2 mb-3">${escapeHtml(article.summary)}</p>`
          : ""}
        <!-- Lean tag -->
        ${article.lean && article.lean !== "Unclear"
          ? `<p class="font-meta-sm text-[10px] text-on-surface-variant mb-3">Lean: <strong>${escapeHtml(article.lean)}</strong> (${article.lean_confidence || 0}% confidence)</p>`
          : ""}

        <!-- ── TASK 2: SOURCE TRUST INDEX ─────────────────── -->
        <div class="mt-auto pt-3 border-t border-outline-variant/50">
          <div class="flex items-center justify-between mb-1">
            <span class="font-meta-sm text-[10px] text-on-surface-variant uppercase tracking-wider" title="Based on editorial standards, fact-checking record, and correction policies.">
              Source Trust Index ℹ
            </span>
            <div class="flex items-center gap-2">
              ${isRumour
                ? `<span class="font-meta-caps text-[10px] ${vClass}">${verdictLabel(rumourVerdict)}</span>`
                : `<span class="font-meta-caps text-[10px] text-on-surface-variant">${verdict}</span>`
              }
              <span class="font-meta-caps text-[11px] font-bold ${tText}">${trust}</span>
            </div>
          </div>
          <div class="h-1 bg-surface-container-high rounded overflow-hidden">
            <div class="credibility-bar ${tClass}" style="width:${trust}%"></div>
          </div>
          ${isRumour ? `
          <div class="flex gap-4 mt-2">
            <span class="font-meta-sm text-[10px] text-emerald-700">✓ True: ${article.rumour_true_probability ?? 50}%</span>
            <span class="font-meta-sm text-[10px] text-red-600">✗ False: ${article.rumour_false_probability ?? 50}%</span>
          </div>` : ""}
        </div>
        <!-- ── END SOURCE TRUST INDEX ──────────────────────── -->

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

// ── Article interactions ───────────────────────
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

// ── TASK 4: Skeleton + cold-start polling ──────
function showSkeletons(count = 5) {
  feedLoader.showLoading();
}

function removeSkeletons() {
  /* handled by renderFeed */
}

let _coldStartResolved = false;

function startColdStartPolling() {
  if (_coldStartResolved) return;
  showSkeletons(5);
  setStatus("Fetching");
  ingestMonitor.ensureRunning();
}

// ── TASK 5: Soft-refresh helpers ───────────────
function showNewArticlesBanner(count) {
  let banner = document.getElementById("new-articles-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "new-articles-banner";
    banner.className = [
      "sticky top-24 z-40 mx-auto mb-4 cursor-pointer",
      "flex items-center justify-center gap-2 px-4 py-2",
      "bg-primary text-on-primary rounded-full shadow-lg",
      "font-meta-sm text-[11px] uppercase w-fit"
    ].join(" ");
    banner.onclick = () => { window.scrollTo({ top: 0, behavior: "smooth" }); banner.remove(); };
    const feed = document.getElementById("article-feed");
    if (feed) feed.parentNode.insertBefore(banner, feed);
  }
  banner.textContent = `↑ ${count} new article${count !== 1 ? "s" : ""} — click to scroll up`;
}

function prependArticleCards(articles) {
  const el = document.getElementById("article-feed");
  if (!el) return;
  articles.reverse().forEach(a => {
    const tmp = document.createElement("div");
    tmp.innerHTML = renderArticle(a);
    const card = tmp.firstElementChild;
    if (card) el.prepend(card);
  });
  bindArticleInteractions(el);
}

// ── Feed renderer ──────────────────────────────
function renderFeed(articles) {
  const el = document.getElementById("article-feed");
  if (!articles.length) {
    el.innerHTML = `<p class="font-body-md text-on-surface-variant py-12 text-center">No articles found. Try a different filter or wait for the next fetch cycle.</p>`;
    return;
  }
  el.innerHTML = articles.map(renderArticle).join("");
  articles.forEach(a => displayedUrls.add(a.url));
  bindArticleInteractions(el);
}

// ── Right sidebar widgets ──────────────────────
function renderTicker(articles) {
  const el = document.getElementById("ticker-content");
  if (!el || !articles.length) return;
  const items   = articles.map(a => `<span class="cursor-pointer hover:text-on-surface transition-colors" onclick="window.open('${a.url}','_blank','noopener')">${escapeHtml(a.title)}</span>`);
  const doubled = [...items, ...items];
  el.innerHTML  = doubled.join('<span class="opacity-30 select-none">  ·  </span>');
}

function _leanSpectrumHTML(breakdown) {
  const order  = ["Left", "Centre", "Right", "Unclear"];
  const colors = { Left: "#3b82f6", Centre: "#10b981", Right: "#ef4444", Unclear: "#9ca3af" };
  if (!breakdown || !Object.keys(breakdown).length)
    return `<p class="font-meta-sm text-[10px] text-on-surface-variant italic text-center">No data yet</p>`;
  return order.map(lean => {
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

function renderLeanSpectrum(breakdown) {
  const d = document.getElementById("lean-spectrum");
  const m = document.getElementById("lean-spectrum-mobile");
  const html = _leanSpectrumHTML(breakdown);
  if (d) d.innerHTML = html;
  if (m) m.innerHTML = html;
}

function _genreBarsHTML(genres, total) {
  if (!genres) return "";
  const top = Object.entries(genres).sort((a, b) => b[1] - a[1]).slice(0, 6);
  return top.map(([genre, count]) => {
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

function renderGenreBars(genres, total) {
  const d = document.getElementById("genre-bars");
  const m = document.getElementById("genre-bars-mobile");
  const html = _genreBarsHTML(genres, total);
  if (d) d.innerHTML = html;
  if (m) m.innerHTML = html;
}

function _trustOverviewHTML(articles) {
  if (!articles.length) return `<p class="font-meta-sm text-[10px] text-on-surface-variant italic">Loading…</p>`;
  const scores = articles.map(a => getSourceTrust(a.source));
  const avg    = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
  const high   = scores.filter(s => s >= 75).length;
  const mid    = scores.filter(s => s >= 60 && s < 75).length;
  const low    = scores.filter(s => s < 60).length;
  const cls    = trustClass(avg);
  const txt    = trustTextColor(avg);
  return `
    <div class="flex items-center gap-3 mb-3">
      <div class="h-2 flex-1 bg-surface-container-high rounded overflow-hidden">
        <div class="credibility-bar ${cls} h-full" style="width:${avg}%"></div>
      </div>
      <span class="font-meta-caps text-[13px] font-bold ${txt}">${avg}</span>
    </div>
    <div class="flex gap-3 text-center">
      <div class="flex-1"><span class="font-meta-sm text-[10px] text-emerald-700 font-bold block">${high}</span><span class="font-meta-sm text-[9px] text-on-surface-variant">Trusted</span></div>
      <div class="flex-1"><span class="font-meta-sm text-[10px] text-amber-600 font-bold block">${mid}</span><span class="font-meta-sm text-[9px] text-on-surface-variant">Mixed</span></div>
      <div class="flex-1"><span class="font-meta-sm text-[10px] text-red-600 font-bold block">${low}</span><span class="font-meta-sm text-[9px] text-on-surface-variant">Low</span></div>
    </div>`;
}

function renderTrustOverview(articles) {
  const html = _trustOverviewHTML(articles);
  const d = document.getElementById("credibility-overview");
  const m = document.getElementById("credibility-overview-mobile");
  if (d) d.innerHTML = html;
  if (m) m.innerHTML = html;
}

function renderArchive(articles) {
  const el = document.getElementById("archive-list");
  if (!el) return;
  el.innerHTML = articles.slice(0, 5).map(a => `
    <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener" class="block group">
      <p class="font-meta-sm text-[11px] text-on-surface group-hover:text-primary transition-colors line-clamp-2 leading-snug">${escapeHtml(a.title)}</p>
      <span class="font-meta-sm text-[10px] text-on-surface-variant">${timeAgo(a.fetched_at)}</span>
    </a>`).join("");
}

// ── Sources tab ────────────────────────────────
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
    const leanClass = l => ({ Left: "bias-left", Right: "bias-right", Centre: "bias-centre", Unclear: "bias-unclear" }[l] || "bias-unclear");
    el.innerHTML = entries.map(([source, leans]) => {
      const total    = Object.values(leans).reduce((s, v) => s + v, 0);
      const dominant = Object.entries(leans).sort((a, b) => b[1] - a[1])[0]?.[0] || "Unclear";
      const trust    = getSourceTrust(source);
      const tText    = trustTextColor(trust);
      const pills    = Object.entries(leans).sort((a, b) => b[1] - a[1])
        .map(([lean, cnt]) => `<span class="px-2 py-0.5 rounded-full font-meta-sm text-[10px] ${leanClass(lean)}">${lean}: ${cnt}</span>`)
        .join("");
      return `<div class="flex items-center justify-between py-4 border-b border-outline-variant gap-4">
        <div>
          <p class="font-meta-sm text-meta-sm text-on-surface font-bold">${escapeHtml(source)}</p>
          <p class="font-meta-sm text-[10px] text-on-surface-variant mt-0.5">
            ${total} articles · Trust: <strong class="${tText}">${trust}</strong> · Dominant: <strong>${dominant}</strong>
          </p>
          <div class="flex flex-wrap gap-1 mt-2">${pills}</div>
        </div>
        <span class="shrink-0 px-3 py-1 rounded-full font-meta-sm text-[10px] ${leanClass(dominant)}">${dominant}</span>
      </div>`;
    }).join("");
  } catch (e) {
    el.innerHTML = `<p class="font-body-md text-error py-8 text-center">Failed to load source data.</p>`;
  }
}

// ── Saved tab ──────────────────────────────────
function renderSavedTab() {
  const el   = document.getElementById("saved-feed");
  const saved = allArticles.filter(a => isSaved(a.id));
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

  ["articles", "sources", "saved"].forEach(t => {
    document.getElementById(`tab-${t}`)?.classList.toggle("active", t === tab);
  });
  document.querySelectorAll(".sidebar-item").forEach(el => el.classList.remove("active"));

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

// ── Status indicator ───────────────────────────
function setStatus(text, live = false) {
  const el = document.getElementById("api-status");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("text-status-live", live);
}

// ── Trigger backend fetch if empty ────────────
async function ensureFetchRunning() {
  if (fetchTriggered) return;
  try {
    const status = await client.fetchStatus();
    if (!status.running && status.total === 0) {
      await client.triggerFetch();
    }
    fetchTriggered = true;
  } catch (e) {
    console.warn("fetch trigger", e);
  }
}

// ── Main full refresh ──────────────────────────
async function refresh(options = {}) {
  const { skipCache = false } = options;
  try {
    const params = { limit: "150" };
    if (!state.isSports && state.genre) params.genre = state.genre;
    if (state.lean) params.lean = state.lean;
    if (state.isRumour) params.is_rumour = "true";
    if (state.isBreaking) params.is_breaking = "true";

    let articles = await client.getArticles(params, { skipCache });

    if (state.isSports) articles = articles.filter(a => SPORTS_GENRES.has(a.genre));

    if (state.searchQuery && state.searchQuery.length >= 3) {
      try {
        articles = await client.search(state.searchQuery, 50, { skipCache });
        if (state.isSports) articles = articles.filter(a => SPORTS_GENRES.has(a.genre));
      } catch (_) {
        const q = state.searchQuery.toLowerCase();
        articles = articles.filter(a =>
          a.title?.toLowerCase().includes(q) ||
          a.summary?.toLowerCase().includes(q) ||
          a.source?.toLowerCase().includes(q)
        );
      }
    } else if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      articles = articles.filter(a =>
        a.title?.toLowerCase().includes(q) ||
        a.summary?.toLowerCase().includes(q) ||
        a.source?.toLowerCase().includes(q)
      );
    }

    allArticles = articles;

    if (articles.length > 0) {
      _coldStartResolved = true;
      ingestMonitor.stop();
      setStatus("Live", true);
    } else {
      await ensureFetchRunning();
      setStatus("Fetching");
    }

    if (state.activeTab === "articles") {
      removeSkeletons();
      renderFeed(articles);
    }

    renderTrustOverview(articles);

    client.trending({ skipCache })
      .then(trending => renderTicker(trending.length ? trending : articles.slice(0, 5)))
      .catch(() => {});

    client.stats({ skipCache })
      .then(stats => {
        renderLeanSpectrum(stats.lean_breakdown || {});
        renderGenreBars(stats.genres_breakdown, stats.total);
        ["stat-sources", "stat-sources-mobile"].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.textContent = stats.total;
        });
        ["stat-alerts", "stat-alerts-mobile"].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.textContent = stats.rumours;
        });
        if (stats.total > 0) setStatus("Live", true);
        renderArchive(articles);
      })
      .catch(() => {});
  } catch (e) {
    console.error(e);
    setStatus("Offline");
    feedLoader.showError(ErrorHandler.parse(e).message);
  }
}

// ── TASK 5: Soft refresh (non-destructive) ─────
async function softRefresh() {
  try {
    const params = { limit: "150" };
    if (!state.isSports && state.genre) params.genre = state.genre;
    if (state.lean) params.lean = state.lean;
    if (state.isRumour) params.is_rumour = "true";
    if (state.isBreaking) params.is_breaking = "true";

    let articles = await client.getArticles(params, { skipCache: true });
    if (state.isSports) articles = articles.filter(a => SPORTS_GENRES.has(a.genre));
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      articles = articles.filter(a =>
        a.title?.toLowerCase().includes(q) || a.source?.toLowerCase().includes(q)
      );
    }
    const newArticles = articles.filter(a => !displayedUrls.has(a.url));
    if (newArticles.length > 0 && state.activeTab === "articles") {
      showNewArticlesBanner(newArticles.length);
      prependArticleCards(newArticles);
      newArticles.forEach(a => displayedUrls.add(a.url));
      allArticles = [...newArticles, ...allArticles];
      renderTrustOverview(allArticles);
    }
  } catch (e) {
    console.warn("softRefresh:", e);
  }
}

// ── Search (debounced + FTS API) ───────────────
function setupSearch() {
  const input = document.getElementById("search-input");
  if (!input) return;

  searchDebouncer = new SearchDebouncer(client, {
    delayMs: 300,
    minLength: 3,
    onClear: (q) => {
      state.searchQuery = q;
      if (!q) refresh();
    },
    onLoading: () => setStatus("Searching"),
    onResults: (results, query) => {
      state.searchQuery = query;
      allArticles = results;
      if (state.activeTab === "articles") renderFeed(results);
      setStatus("Live", true);
    },
    onError: (err) => {
      setStatus("Offline");
      showApiError("article-feed", err);
    },
  });

  input.addEventListener("input", () => {
    const val = input.value.trim();
    state.searchQuery = val;
    if (val.length >= 3) {
      searchDebouncer.search(val);
    } else if (!val) {
      searchDebouncer.cancel();
      refresh();
    } else {
      searchDebouncer.cancel();
      refresh();
    }
  });
}

// ── Mobile left sidebar ────────────────────────
function openSidebar()  {
  document.getElementById("sidebar")?.classList.add("mobile-open", "flex");
  document.getElementById("mobile-overlay")?.classList.add("open");
}
function closeSidebar() {
  document.getElementById("sidebar")?.classList.remove("mobile-open");
  document.getElementById("mobile-overlay")?.classList.remove("open");
}
window.closeSidebar = closeSidebar;

// ── TASK 8: Analysis Hub bottom sheet (mobile) ─
function setupAnalysisFab() {
  const fab      = document.getElementById("analysis-fab");
  const sheet    = document.getElementById("analysis-sheet");
  const backdrop = document.getElementById("analysis-sheet-backdrop");
  const close    = document.getElementById("analysis-sheet-close");
  if (!fab || !sheet) return;

  const open = () => {
    sheet.classList.remove("translate-y-full");
    sheet.classList.add("translate-y-0");
    backdrop.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  };
  const dismiss = () => {
    sheet.classList.add("translate-y-full");
    sheet.classList.remove("translate-y-0");
    backdrop.classList.add("hidden");
    document.body.style.overflow = "";
  };

  fab.addEventListener("click", open);
  close?.addEventListener("click", dismiss);
  backdrop?.addEventListener("click", dismiss);
}

// ── TASK 9: Filter memory ──────────────────────
function saveFilterState() {
  localStorage.setItem("newslens_filters", JSON.stringify({
    genre:      state.genre,
    lean:       state.lean,
    isSports:   state.isSports,
    isRumour:   state.isRumour,
    isBreaking: state.isBreaking,
  }));
}

function loadFilterState() {
  try {
    const saved = JSON.parse(localStorage.getItem("newslens_filters") || "{}");
    if (saved.genre)      state.genre      = saved.genre;
    if (saved.lean)       state.lean       = saved.lean;
    if (saved.isSports)   state.isSports   = saved.isSports;
    if (saved.isRumour)   state.isRumour   = saved.isRumour;
    if (saved.isBreaking) state.isBreaking = saved.isBreaking;
    if (saved.lean) {
      const lbl = document.getElementById("filter-lean-label");
      if (lbl) lbl.textContent = saved.lean;
    }
  } catch (_) {}
}

// ── Nav setup ──────────────────────────────────
function setupNav() {
  document.querySelectorAll("[data-nav-genre]").forEach(link => {
    link.addEventListener("click", e => {
      e.preventDefault();
      const label  = link.dataset.navGenre;
      const mapped = NAV_GENRES[label];
      state.isSports   = (mapped === "__sports__");
      state.genre      = state.isSports ? null : (mapped || null);
      state.isRumour   = false;
      state.isBreaking = false;
      state.activeTab  = "articles";
      switchTab("articles");
      document.querySelectorAll("[data-nav-genre]").forEach(l => {
        l.classList.remove("text-primary", "border-b-2", "border-primary", "pb-1");
        l.classList.add("text-on-surface-variant");
      });
      link.classList.add("text-primary", "border-b-2", "border-primary", "pb-1");
      link.classList.remove("text-on-surface-variant");
      document.getElementById("feed-title").textContent = label;
      document.getElementById("feed-label").textContent = label === "Sports" ? "Sports Intelligence" : "Genre Filter";
      saveFilterState();
      refresh();
    });
  });

  document.getElementById("filter-lean")?.addEventListener("click", () => {
    const cycle = [null, "Left", "Centre", "Right", "Unclear"];
    const idx   = (cycle.indexOf(state.lean) + 1) % cycle.length;
    state.lean  = cycle[idx];
    document.getElementById("filter-lean-label").textContent = state.lean || "All";
    if (state.activeTab !== "articles") switchTab("articles");
    saveFilterState();
    refresh();
  });

  document.getElementById("filter-all")?.addEventListener("click", () => {
    state.genre      = null;
    state.lean       = null;
    state.isRumour   = false;
    state.isBreaking = false;
    state.isSports   = false;
    document.getElementById("feed-title").textContent = "Forensic Digest";
    document.getElementById("feed-label").textContent = "Intelligence Stream";
    document.getElementById("filter-lean-label").textContent = "All";
    switchTab("articles");
    saveFilterState();
    refresh();
  });

  document.getElementById("filter-rumours")?.addEventListener("click", () => {
    state.isRumour   = !state.isRumour;
    state.isBreaking = false;
    state.genre      = null;
    state.isSports   = false;
    state.activeTab  = "articles";
    document.getElementById("filter-rumours")?.classList.toggle("active", state.isRumour);
    document.getElementById("feed-title").textContent = state.isRumour ? "Rumour Watch"      : "Forensic Digest";
    document.getElementById("feed-label").textContent = state.isRumour ? "Unverified Claims" : "Intelligence Stream";
    switchTab("articles");
    saveFilterState();
    refresh();
  });

  document.getElementById("filter-sources")?.addEventListener("click", () => switchTab("sources"));
  document.getElementById("filter-saved")?.addEventListener("click",   () => switchTab("saved"));

  document.getElementById("filter-breaking")?.addEventListener("click", () => {
    state.isBreaking = !state.isBreaking;
    state.isRumour   = false;
    state.genre      = null;
    state.isSports   = false;
    document.getElementById("filter-breaking")?.classList.toggle("active", state.isBreaking);
    document.getElementById("feed-title").textContent = state.isBreaking ? "Breaking News"   : "Forensic Digest";
    document.getElementById("feed-label").textContent = state.isBreaking ? "Verified Alerts" : "Intelligence Stream";
    switchTab("articles");
    saveFilterState();
    refresh();
  });

  document.getElementById("filter-sports")?.addEventListener("click", () => {
    state.isSports   = true;
    state.genre      = null;
    state.isRumour   = false;
    state.isBreaking = false;
    state.activeTab  = "articles";
    document.querySelectorAll(".sidebar-item").forEach(el => el.classList.remove("active"));
    document.getElementById("filter-sports")?.classList.add("active");
    document.getElementById("feed-title").textContent = "Sports";
    document.getElementById("feed-label").textContent = "Sports Intelligence";
    switchTab("articles");
    saveFilterState();
    refresh();
  });

  document.getElementById("refresh-btn")?.addEventListener("click", () => {
    client.invalidateArticles();
    refresh({ skipCache: true });
  });
  document.getElementById("mobile-menu-btn")?.addEventListener("click", openSidebar);

  const docsLink = document.getElementById("api-docs-link");
  if (docsLink) docsLink.href = `${API}/docs`;
}

// ── Init ───────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  updateSavedCount();
  setupSearch();
  setupNav();
  loadFilterState();    // Task 9: restore filters before first render
  setupAnalysisFab();   // Task 8: mobile bottom sheet

  // Task 4: show skeletons immediately, then try to fetch
  refresh().then(() => {
    if (allArticles.length === 0) {
      startColdStartPolling();
    } else {
      client.health().catch(() => {});
    }
  });

  // Task 5: soft refresh every 5 min — never wipes scroll position
  setInterval(softRefresh, 5 * 60 * 1000);
});
