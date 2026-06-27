/**
 * NewsLens Frontend API Integration Layer
 * Centralized fetch, caching, ingest monitoring, search, and error handling.
 */
(function (global) {
  "use strict";

  const LOG_PREFIX = "[NewsLens API]";

  // ─── API URL Detection ───────────────────────────────────────────────

  function resolveApiUrl() {
    if (typeof global.NEWS_LENS_API === "string") {
      return global.NEWS_LENS_API.replace(/\/$/, "");
    }

    const meta = document.querySelector('meta[name="api-url"]')?.content;
    if (meta) return meta.replace(/\/$/, "");

    const params = new URLSearchParams(global.location.search);
    const fromQuery = params.get("api") || params.get("api_url");
    if (fromQuery) return fromQuery.replace(/\/$/, "");

    const { protocol, hostname, port, pathname } = global.location;

    if (pathname.startsWith("/app") || port === "8000") {
      return "";
    }

    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return `${protocol}//${hostname}:8000`;
    }

    return "";
  }

  // ─── ErrorHandler ────────────────────────────────────────────────────

  class ErrorHandler {
    static parse(error) {
      if (!navigator.onLine) {
        return {
          code: "offline",
          message: "You appear to be offline. Check your connection and try again.",
          retryable: true,
        };
      }

      if (error?.name === "AbortError") {
        return {
          code: "timeout",
          message: "Request timed out after 10 seconds. Please try again.",
          retryable: true,
        };
      }

      const status = error?.status;
      if (status === 401 || status === 403) {
        return {
          code: "auth",
          message: "Session expired or unauthorized. Please refresh the page.",
          retryable: false,
        };
      }
      if (status === 429) {
        return {
          code: "rate_limit",
          message: "Too many requests. Please wait a moment and try again.",
          retryable: true,
        };
      }
      if (status >= 500) {
        return {
          code: "server",
          message: "Server error. Our team has been notified — try again shortly.",
          retryable: true,
        };
      }
      if (error?.code === "network") {
        return {
          code: "network",
          message: "Cannot reach the API. Check your connection or start the backend.",
          retryable: true,
        };
      }

      return {
        code: "unknown",
        message: error?.message || "Something went wrong. Please try again.",
        retryable: true,
      };
    }

    static log(error, context = {}) {
      console.warn(LOG_PREFIX, context.method || "request", ErrorHandler.parse(error), context);
    }
  }

  // ─── CacheManager ────────────────────────────────────────────────────

  class CacheManager {
    constructor(prefix = "nl_cache_") {
      this.prefix = prefix;
      this.memory = new Map();
    }

    _key(key) {
      return `${this.prefix}${key}`;
    }

    get(key) {
      const mem = this.memory.get(key);
      if (mem && mem.expiresAt > Date.now()) {
        return mem.value;
      }
      if (mem) this.memory.delete(key);

      try {
        const raw = localStorage.getItem(this._key(key));
        if (!raw) return null;
        const entry = JSON.parse(raw);
        if (entry.expiresAt <= Date.now()) {
          localStorage.removeItem(this._key(key));
          return null;
        }
        this.memory.set(key, entry);
        return entry.value;
      } catch {
        return null;
      }
    }

    set(key, value, ttlMs) {
      const entry = { value, expiresAt: Date.now() + ttlMs };
      this.memory.set(key, entry);
      try {
        localStorage.setItem(this._key(key), JSON.stringify(entry));
      } catch (e) {
        console.warn(LOG_PREFIX, "localStorage cache full", e);
      }
    }

    delete(key) {
      this.memory.delete(key);
      try {
        localStorage.removeItem(this._key(key));
      } catch (_) {}
    }

    clearPattern(pattern) {
      const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
      for (const key of [...this.memory.keys()]) {
        if (regex.test(key)) this.memory.delete(key);
      }
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k?.startsWith(this.prefix) && regex.test(k.slice(this.prefix.length))) {
            localStorage.removeItem(k);
          }
        }
      } catch (_) {}
    }

    clearAll() {
      this.memory.clear();
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k?.startsWith(this.prefix)) localStorage.removeItem(k);
        }
      } catch (_) {}
    }
  }

  // ─── PerformanceMonitor ──────────────────────────────────────────────

  class PerformanceMonitor {
    constructor() {
      this.metrics = {
        requests: 0,
        cacheHits: 0,
        cacheMisses: 0,
        errors: 0,
        totalLatencyMs: 0,
      };
    }

    recordRequest(latencyMs, fromCache = false) {
      this.metrics.requests++;
      this.metrics.totalLatencyMs += latencyMs;
      if (fromCache) this.metrics.cacheHits++;
      else this.metrics.cacheMisses++;
    }

    recordError() {
      this.metrics.errors++;
    }

    getStats() {
      const { requests, cacheHits, totalLatencyMs } = this.metrics;
      return {
        ...this.metrics,
        avgLatencyMs: requests ? Math.round(totalLatencyMs / requests) : 0,
        cacheHitRate: requests ? Math.round((cacheHits / requests) * 100) : 0,
      };
    }
  }

  // ─── APIClient ───────────────────────────────────────────────────────

  class APIClient {
    constructor(options = {}) {
      this.baseUrl = (options.baseUrl ?? resolveApiUrl()).replace(/\/$/, "");
      this.timeoutMs = options.timeoutMs ?? 10_000;
      this.maxRetries = options.maxRetries ?? 3;
      this.cache = options.cache ?? new CacheManager();
      this.perf = options.perf ?? new PerformanceMonitor();
      this.inflight = new Map();

      this.ttl = {
        articles: options.ttlArticles ?? 60_000,
        search: options.ttlSearch ?? 300_000,
        stats: options.ttlStats ?? 60_000,
        health: options.ttlHealth ?? 30_000,
        default: options.ttlDefault ?? 60_000,
      };
    }

    _url(path) {
      const p = path.startsWith("/") ? path : `/${path}`;
      return `${this.baseUrl}${p}`;
    }

    async _fetchWithTimeout(url, options = {}) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        if (!res.ok) {
          const err = new Error(`HTTP ${res.status}: ${res.statusText}`);
          err.status = res.status;
          throw err;
        }
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          return res.json();
        }
        return res.text();
      } catch (e) {
        if (e.name === "TypeError") {
          const err = new Error("Network request failed");
          err.code = "network";
          throw err;
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    }

    async _request(path, options = {}) {
      const {
        method = "GET",
        body,
        cacheKey,
        cacheTtl,
        skipCache = false,
        dedupe = method === "GET",
        headers = {},
      } = options;

      const url = this._url(path);
      const key = cacheKey ?? `${method}:${path}`;

      if (!skipCache && method === "GET" && cacheKey !== false) {
        const cached = this.cache.get(key);
        if (cached !== null) {
          this.perf.recordRequest(0, true);
          return cached;
        }
      }

      if (dedupe && this.inflight.has(key)) {
        return this.inflight.get(key);
      }

      const exec = (async () => {
        const start = performance.now();
        let lastError;

        for (let attempt = 0; attempt < this.maxRetries; attempt++) {
          try {
            const fetchOpts = {
              method,
              headers: { ...headers },
            };
            if (body !== undefined) {
              fetchOpts.headers["Content-Type"] = "application/json";
              fetchOpts.body = JSON.stringify(body);
            }

            const data = await this._fetchWithTimeout(url, fetchOpts);
            const latency = Math.round(performance.now() - start);
            this.perf.recordRequest(latency, false);

            if (!skipCache && method === "GET" && cacheKey !== false) {
              this.cache.set(key, data, cacheTtl ?? this.ttl.default);
            }

            return data;
          } catch (e) {
            lastError = e;
            ErrorHandler.log(e, { method, path, attempt });
            if (attempt < this.maxRetries - 1) {
              await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
            }
          }
        }

        this.perf.recordError();
        throw lastError;
      })();

      if (dedupe) {
        this.inflight.set(key, exec);
        exec.finally(() => this.inflight.delete(key));
      }

      return exec;
    }

    get(path, opts = {}) {
      return this._request(path, { ...opts, method: "GET" });
    }

    post(path, body, opts = {}) {
      return this._request(path, { ...opts, method: "POST", body, skipCache: true, cacheKey: false });
    }

    // ── Domain methods ──

    health(opts = {}) {
      return this.get("/health", { cacheKey: "health", cacheTtl: this.ttl.health, ...opts });
    }

    getArticles(params = {}, opts = {}) {
      const qs = new URLSearchParams(params).toString();
      const path = qs ? `/articles?${qs}` : "/articles";
      return this.get(path, {
        cacheKey: `articles:${qs}`,
        cacheTtl: this.ttl.articles,
        ...opts,
      });
    }

    search(query, limit = 20, opts = {}) {
      const q = encodeURIComponent(query);
      return this.get(`/search?q=${q}&limit=${limit}`, {
        cacheKey: `search:${query}:${limit}`,
        cacheTtl: this.ttl.search,
        ...opts,
      });
    }

    trending(opts = {}) {
      return this.get("/trending", { cacheKey: "trending", cacheTtl: this.ttl.articles, ...opts });
    }

    stats(opts = {}) {
      return this.get("/stats", { cacheKey: "stats", cacheTtl: this.ttl.stats, ...opts });
    }

    fetchStatus(opts = {}) {
      return this.get("/fetch/status", { cacheKey: false, skipCache: true, dedupe: false, ...opts });
    }

    triggerFetch(opts = {}) {
      return this.post("/fetch", null, opts);
    }

    async savePrefs(prefs) {
      try {
        return await this.post("/prefs", prefs);
      } catch (e) {
        if (e.status === 404) {
          localStorage.setItem("nl_prefs", JSON.stringify(prefs));
          return { saved: true, storage: "local" };
        }
        throw e;
      }
    }

    loadPrefs() {
      try {
        return JSON.parse(localStorage.getItem("nl_prefs") || "{}");
      } catch {
        return {};
      }
    }

    invalidateArticles() {
      this.cache.clearPattern(/^articles:/);
      this.cache.delete("trending");
      this.cache.delete("stats");
    }
  }

  // ─── LoadingStateManager ─────────────────────────────────────────────

  class LoadingStateManager {
    constructor(container, options = {}) {
      this.container = typeof container === "string" ? document.getElementById(container) : container;
      this.skeletonCount = options.skeletonCount ?? 5;
      this.skeletonClass = options.skeletonClass ?? "skeleton-card bg-surface-container-high rounded-xl h-32 mb-4";
      this._state = "idle";
    }

    showLoading() {
      if (!this.container) return;
      this._state = "loading";
      this.container.innerHTML = Array(this.skeletonCount)
        .fill(`<div class="${this.skeletonClass}"></div>`)
        .join("");
    }

    showError(message) {
      if (!this.container) return;
      this._state = "error";
      this.container.innerHTML = `
        <div class="py-12 text-center">
          <p class="font-body-md text-error mb-2">${message}</p>
          <button type="button" class="font-meta-sm text-primary underline retry-btn">Try again</button>
        </div>`;
    }

    showEmpty(message = "No articles found.") {
      if (!this.container) return;
      this._state = "empty";
      this.container.innerHTML = `<p class="font-body-md text-on-surface-variant py-12 text-center">${message}</p>`;
    }

    showContent(html) {
      if (!this.container) return;
      this._state = "success";
      this.container.innerHTML = html;
    }

    onRetry(fn) {
      this.container?.addEventListener("click", (e) => {
        if (e.target.closest(".retry-btn")) fn();
      });
    }

    get state() {
      return this._state;
    }
  }

  // ─── SearchDebouncer ─────────────────────────────────────────────────

  class SearchDebouncer {
    constructor(apiClient, options = {}) {
      this.client = apiClient;
      this.delayMs = options.delayMs ?? 300;
      this.minLength = options.minLength ?? 3;
      this.timer = null;
      this.abortGen = 0;
      this.onResults = options.onResults ?? (() => {});
      this.onLoading = options.onLoading ?? (() => {});
      this.onError = options.onError ?? (() => {});
      this.onClear = options.onClear ?? (() => {});
    }

    search(query) {
      clearTimeout(this.timer);
      const trimmed = (query || "").trim();

      if (trimmed.length < this.minLength) {
        this.onClear(trimmed);
        return;
      }

      this.timer = setTimeout(async () => {
        const gen = ++this.abortGen;
        this.onLoading(trimmed);

        try {
          const results = await this.client.search(trimmed);
          if (gen !== this.abortGen) return;
          this.onResults(results, trimmed);
        } catch (e) {
          if (gen !== this.abortGen) return;
          this.onError(ErrorHandler.parse(e), trimmed);
        }
      }, this.delayMs);
    }

    cancel() {
      clearTimeout(this.timer);
      this.abortGen++;
    }
  }

  // ─── IngestMonitor ───────────────────────────────────────────────────

  class IngestMonitor {
    constructor(apiClient, options = {}) {
      this.client = apiClient;
      this.intervalMs = options.intervalMs ?? 1000;
      this.maxPolls = options.maxPolls ?? 120;
      this.timer = null;
      this.pollCount = 0;
      this.listeners = {
        progress: new Set(),
        complete: new Set(),
        error: new Set(),
      };

      this.ui = {
        panel: options.panelId ? document.getElementById(options.panelId) : null,
        bar: options.barId ? document.getElementById(options.barId) : null,
        label: options.labelId ? document.getElementById(options.labelId) : null,
      };
    }

    on(event, fn) {
      this.listeners[event]?.add(fn);
      return () => this.listeners[event]?.delete(fn);
    }

    _emit(event, data) {
      this.listeners[event]?.forEach((fn) => fn(data));
    }

    _updateUI(status) {
      const total = status.total_to_process || 0;
      const processed = status.processed || 0;
      const dbTotal = status.total || 0;
      const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : dbTotal > 0 ? 100 : 0;

      if (this.ui.panel) this.ui.panel.classList.remove("hidden");
      if (this.ui.bar) this.ui.bar.style.width = `${pct}%`;
      if (this.ui.label) {
        if (status.running && total > 0) {
          this.ui.label.textContent = `Classifying ${processed}/${total} articles…`;
        } else if (status.running) {
          this.ui.label.textContent = "Fetching live sources…";
        } else if (dbTotal > 0) {
          this.ui.label.textContent = "Analysis complete";
        } else {
          this.ui.label.textContent = "Waiting for first articles…";
        }
      }
    }

    async _poll() {
      try {
        const status = await this.client.fetchStatus();
        this._updateUI(status);
        this._emit("progress", status);

        const done =
          !status.running &&
          (status.total > 0 || (status.total_to_process > 0 && status.processed >= status.total_to_process));

        if (done || (status.total > 0 && !status.running)) {
          this.stop();
          this._emit("complete", status);
          if (this.ui.panel) {
            setTimeout(() => this.ui.panel?.classList.add("hidden"), 1500);
          }
          return;
        }

        this.pollCount++;
        if (this.pollCount >= this.maxPolls) {
          this.stop();
          this._emit("error", { message: "Ingest polling timed out" });
        }
      } catch (e) {
        this._emit("error", ErrorHandler.parse(e));
      }
    }

    start() {
      this.stop();
      this.pollCount = 0;
      this._poll();
      this.timer = setInterval(() => this._poll(), this.intervalMs);
    }

    stop() {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    }

    async ensureRunning() {
      try {
        const status = await this.client.fetchStatus();
        if (!status.running && status.total === 0) {
          await this.client.triggerFetch();
        }
        this.start();
      } catch (e) {
        this._emit("error", ErrorHandler.parse(e));
      }
    }
  }

  // ─── Export ──────────────────────────────────────────────────────────

  const defaultClient = new APIClient();

  global.NewsLensAPI = {
    resolveApiUrl,
    ErrorHandler,
    CacheManager,
    PerformanceMonitor,
    APIClient,
    LoadingStateManager,
    SearchDebouncer,
    IngestMonitor,
    client: defaultClient,
  };

  global.NEWS_LENS_API = global.NEWS_LENS_API ?? resolveApiUrl();

  // ─── Example Usage ───────────────────────────────────────────────────
  //
  // const { client, IngestMonitor, SearchDebouncer, ErrorHandler } = NewsLensAPI;
  //
  // // Load articles (cached 1 min)
  // const articles = await client.getArticles({ limit: 50 });
  //
  // // Force refresh (skip cache)
  // const fresh = await client.getArticles({ limit: 50 }, { skipCache: true });
  //
  // // Monitor ingest with progress UI
  // const monitor = new IngestMonitor(client, {
  //   panelId: "ingestProgress",
  //   barId: "ingestProgressBar",
  //   labelId: "ingestEta",
  // });
  // monitor.on("complete", () => loadArticles());
  // monitor.ensureRunning();
  //
  // // Debounced search
  // const search = new SearchDebouncer(client, {
  //   onResults: (results) => console.log(results),
  //   onError: (err) => console.warn(err.message),
  // });
  // searchInput.addEventListener("input", (e) => search.search(e.target.value));
})(window);
