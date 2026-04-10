const SHARE_CACHE = "wrapchat-share-target-v1";
const SHARE_KEY = "/__wrapchat_share_target__/pending";
const SHARE_TARGET_PATH = "/import";
const SHARE_REQUEST = "WRAPCHAT_SHARE_REQUEST";
const SHARE_FILE = "WRAPCHAT_SHARE_FILE";
const SHARE_READY = "WRAPCHAT_SHARE_READY";
const SHARE_CLEAR = "WRAPCHAT_SHARE_CLEAR";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.method === "POST" && url.pathname === SHARE_TARGET_PATH) {
    event.respondWith(handleShareTarget(event));
    return;
  }

  if (event.request.method === "GET" && event.request.mode === "navigate" && url.pathname === SHARE_TARGET_PATH) {
    event.respondWith(fetch(new Request("/", { method: "GET" })));
  }
});

self.addEventListener("message", event => {
  const type = event.data?.type;
  if (type === SHARE_REQUEST) {
    event.waitUntil(sendPendingShareToClient(event.source));
    return;
  }

  if (type === SHARE_CLEAR) {
    event.waitUntil(clearPendingShare());
  }
});

async function handleShareTarget(event) {
  const formData = await event.request.formData();
  const file = extractSharedFile(formData);

  if (file) await storePendingShare(file);

  const client = await self.clients.openWindow(SHARE_TARGET_PATH);
  await notifyClients(client);

  return Response.redirect(new URL(SHARE_TARGET_PATH, self.location.origin).toString(), 303);
}

function extractSharedFile(formData) {
  const directFile = formData.get("chat");
  if (directFile instanceof File) return directFile;

  for (const value of formData.values()) {
    if (value instanceof File) return value;
  }

  return null;
}

async function storePendingShare(file) {
  const cache = await caches.open(SHARE_CACHE);
  const headers = new Headers({
    "content-type": file.type || "application/octet-stream",
    "x-wrapchat-filename": encodeURIComponent(file.name || "shared-chat"),
    "x-wrapchat-last-modified": String(file.lastModified || Date.now()),
  });
  await cache.put(SHARE_KEY, new Response(file, { headers }));
}

async function readPendingShare() {
  const cache = await caches.open(SHARE_CACHE);
  const response = await cache.match(SHARE_KEY);
  if (!response) return null;

  const blob = await response.blob();
  const filename = decodeURIComponent(response.headers.get("x-wrapchat-filename") || "shared-chat");
  const type = response.headers.get("content-type") || blob.type || "application/octet-stream";
  const lastModified = Number(response.headers.get("x-wrapchat-last-modified")) || Date.now();

  return new File([blob], filename, { type, lastModified });
}

async function clearPendingShare() {
  const cache = await caches.open(SHARE_CACHE);
  await cache.delete(SHARE_KEY);
}

async function sendPendingShareToClient(client) {
  if (!client || typeof client.postMessage !== "function") return;
  const file = await readPendingShare();
  client.postMessage({ type: SHARE_FILE, file });
}

async function notifyClients(openedClient) {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const notified = new Set();

  for (const client of clients) {
    if (!client || typeof client.postMessage !== "function") continue;
    client.postMessage({ type: SHARE_READY });
    notified.add(client.id);
  }

  if (openedClient && typeof openedClient.postMessage === "function" && !notified.has(openedClient.id)) {
    openedClient.postMessage({ type: SHARE_READY });
  }
}
