// ============================================
// Service worker - Joma Jewellery World Cup Sweepstake
// Makes the site installable as a PWA and keeps
// it working (with the last-seen data) offline.
// ============================================

// Bump this version whenever the cached app shell changes so clients
// pick up the new files instead of serving stale ones.
const CACHE_VERSION = "joma-sweepstake-v1";
const SHELL_CACHE = CACHE_VERSION + "-shell";
const DATA_CACHE = CACHE_VERSION + "-data";

// Core files that make up the app shell (cached on install).
const SHELL_ASSETS = [
    "./",
    "./index.html",
    "./style.css",
    "./data.js",
    "./app.js",
    "./manifest.webmanifest",
    "./icon.svg",
    "./icon-maskable.svg",
];

// Live data files refreshed by the results workflow. Requested with a
// cache-busting "?v=" query, so we key the cache on the path only.
const DATA_FILES = ["schedule.json", "results.json", "tracker-state.json"];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then((cache) => cache.addAll(SHELL_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((k) => !k.startsWith(CACHE_VERSION))
                    .map((k) => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET") return;

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;  // only handle same-origin

    const isData = DATA_FILES.some((f) => url.pathname.endsWith(f));

    if (isData) {
        // Network-first: always try for fresh results, fall back to the last
        // cached copy when offline. Cache keyed on path (ignoring ?v=).
        event.respondWith(
            fetch(req)
                .then((res) => {
                    const copy = res.clone();
                    caches.open(DATA_CACHE).then((c) => c.put(url.pathname, copy));
                    return res;
                })
                .catch(() => caches.open(DATA_CACHE).then((c) => c.match(url.pathname)))
        );
        return;
    }

    // App shell: cache-first, with a background refresh for next time.
    event.respondWith(
        caches.match(req).then((cached) => {
            const network = fetch(req)
                .then((res) => {
                    if (res && res.ok) {
                        const copy = res.clone();
                        caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
                    }
                    return res;
                })
                .catch(() => cached);
            return cached || network;
        })
    );
});
