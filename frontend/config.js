window.NEWS_LENS_API = (() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get("api")) return params.get("api").replace(/\/$/, "");

  const { protocol, hostname, port, pathname } = window.location;
  const host = hostname || "127.0.0.1";

  // Dashboard served from backend at /app/ — same origin, no CORS
  if (port === "8000" || pathname.startsWith("/app")) {
    return "";
  }

  // Standalone frontend (e.g. port 3000) — talk directly to API
  return `${protocol}//${host}:8000`;
})();
