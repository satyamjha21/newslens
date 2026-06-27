window.NEWS_LENS_API = (() => {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("api") || params.get("api_url");
  if (fromQuery) return fromQuery.replace(/\/$/, "");

  const meta = document.querySelector('meta[name="api-url"]')?.content;
  if (meta) return meta.replace(/\/$/, "");

  const { protocol, hostname, port, pathname } = window.location;
  const host = hostname || "127.0.0.1";

  if (port === "8000" || pathname.startsWith("/app")) {
    return "";
  }

  if (host === "localhost" || host === "127.0.0.1") {
    return `${protocol}//${host}:8000`;
  }

  return "";
})();
