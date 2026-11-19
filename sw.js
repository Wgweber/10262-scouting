/* 10262 Scouting — service worker: makes the app open with no internet,
 * and (on Android/Chrome) uploads waiting reports even after the app is closed. */
const VERSION = "es-shell-v7";
const SHELL = [
  "./", "index.html", "manifest.webmanifest", "css/app.css",
  "js/config.js", "js/tba.js", "js/game.js", "js/combine.js", "js/stats.js", "js/model.js", "js/core.js", "js/io.js", "js/qr.js",
  "js/charts.js", "js/ui.js", "js/ui-analysis.js", "js/ui-picklist.js", "js/ui-admin.js", "js/boot.js",
  "vendor/xlsx.full.min.js", "vendor/qrcode.js", "vendor/jsQR.js",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png", "icons/logo-96.png"
];
importScripts("js/config.js", "js/core.js");

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))));
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION && k.startsWith("es-shell")) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener("message", (e) => { if (e.data === "skipWaiting") self.skipWaiting(); });

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return; // cloud + Blue Alliance go straight to the network
  if (req.mode === "navigate") {
    e.respondWith(caches.match("index.html").then((hit) => hit || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
    return res;
  })));
});

// Background Sync (Chrome/Android): the browser calls this when the connection returns.
self.addEventListener("sync", (e) => {
  if (e.tag !== "es-push") return;
  e.waitUntil(self.ESCore.syncNow({ pullToo: false }).then(async (st) => {
    const clients = await self.clients.matchAll();
    clients.forEach((c) => c.postMessage("synced"));
    if (!st.ok && self.ESCore.cloudReady(await self.ESCore.getSettings())) throw new Error(st.error); // ask the browser to retry later
  }));
});
