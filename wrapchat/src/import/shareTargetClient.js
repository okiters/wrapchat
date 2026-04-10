const SHARE_REQUEST = "WRAPCHAT_SHARE_REQUEST";
const SHARE_FILE = "WRAPCHAT_SHARE_FILE";
const SHARE_READY = "WRAPCHAT_SHARE_READY";
const SHARE_CLEAR = "WRAPCHAT_SHARE_CLEAR";

async function getActiveServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.ready.catch(() => null);
  if (!registration) return null;
  return navigator.serviceWorker.controller || registration.active || registration.waiting || null;
}

export function subscribeToShareTargetEvents(listener) {
  if (!("serviceWorker" in navigator)) return () => {};

  const handleMessage = event => {
    const type = event.data?.type;
    if (type === SHARE_READY || type === SHARE_FILE) listener(event.data);
  };

  navigator.serviceWorker.addEventListener("message", handleMessage);
  return () => navigator.serviceWorker.removeEventListener("message", handleMessage);
}

export async function requestSharedFileFromServiceWorker(timeoutMs = 1500) {
  const worker = await getActiveServiceWorker();
  if (!worker) return null;

  return new Promise(resolve => {
    let settled = false;

    const cleanup = () => {
      navigator.serviceWorker.removeEventListener("message", handleMessage);
      window.clearTimeout(timeoutId);
    };

    const finish = file => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(file || null);
    };

    const handleMessage = event => {
      if (event.data?.type !== SHARE_FILE) return;
      finish(event.data.file || null);
    };

    const timeoutId = window.setTimeout(() => finish(null), timeoutMs);
    navigator.serviceWorker.addEventListener("message", handleMessage);
    worker.postMessage({ type: SHARE_REQUEST });
  });
}

export async function clearSharedFileFromServiceWorker() {
  const worker = await getActiveServiceWorker();
  if (!worker) return;
  worker.postMessage({ type: SHARE_CLEAR });
}
