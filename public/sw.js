/* PWA service worker — network-first pages, cache-first assets */
const CACHE = "gymtrack-v3";
const STATIC = ["/", "/home/", "/training/", "/stats/", "/settings/", "/manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(STATIC))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;

  const url = new URL(e.request.url);

  // Skip Supabase API calls — never cache these (data is managed by IndexedDB queue)
  if (url.hostname.includes("supabase")) return;

  // Intercept Next.js RSC payload requests and redirect to the static .txt files
  if (url.searchParams.has("_rsc")) {
    let txtPath = url.pathname;
    if (txtPath === "/") {
      txtPath = "/index.txt";
    } else if (txtPath.endsWith("/")) {
      txtPath += "index.txt";
    } else {
      txtPath += "/index.txt";
    }
    const txtUrl = new URL(txtPath, url.origin);
    e.respondWith(
      fetch(txtUrl)
        .then((res) => {
          if (!res.ok) throw new Error("RSC fetch failed");
          return res;
        })
        .catch(() => caches.match(txtUrl).then((hit) => hit ?? Response.error()))
    );
    return;
  }

  // App shell pages: network-first with cache fallback so pages stay fresh
  if (STATIC.includes(url.pathname) || url.pathname === "/login/") {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request).then((hit) => hit ?? Response.error()))
    );
    return;
  }

  // Static assets (JS, CSS, fonts, images): cache-first
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
