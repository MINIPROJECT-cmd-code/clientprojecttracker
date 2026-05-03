const RENDER_API_BASE_URL = "https://client-project-tracker.onrender.com";
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

window.APP_CONFIG = {
  // Local dev uses the same Node server origin. Deployed Firebase hosting uses Render.
  API_BASE_URL: LOCAL_HOSTNAMES.has(window.location.hostname) ? "" : RENDER_API_BASE_URL
};
