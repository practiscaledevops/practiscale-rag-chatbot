/* Service worker for the PractiScale Assistant PWA.
 *
 * Deliberately minimal. The app is a live, authenticated chat client: answers
 * stream, knowledge changes, and every API call carries the session, so NOTHING
 * dynamic is ever cached. The worker exists to (1) make the app installable,
 * (2) keep the icons/manifest available instantly, and (3) show a branded
 * "you're offline" page instead of the browser's error when the network is gone.
 *
 * Rules:
 *   - /api/*, auth, and any non-GET request: network only, never touched.
 *   - Navigations (page loads): network first; on failure → the offline page.
 *   - Same-origin static assets (/_next/static, icons, fonts): cache first —
 *     they are content-hashed or immutable, so this is always safe.
 */
const VERSION = "v1";
const SHELL_CACHE = `assistant-shell-${VERSION}`;
const STATIC_CACHE = `assistant-static-${VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icon-192.png", "/icon-512.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== STATIC_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isStaticAsset(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") ||
      /\.(?:png|ico|svg|webp|woff2?)$/.test(url.pathname) ||
      url.pathname === "/manifest.webmanifest")
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.open(SHELL_CACHE).then((cache) => cache.match(OFFLINE_URL)))
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })
    );
  }
});
