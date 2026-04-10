import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import Root from "./Root.jsx";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const isLocalhost = ["localhost", "127.0.0.1"].includes(window.location.hostname);

    if (isLocalhost || import.meta.env.DEV) {
      navigator.serviceWorker.getRegistrations()
        .then(registrations => Promise.all(registrations.map(reg => reg.unregister())))
        .catch(() => {
          // Silent: dev should still work even if cleanup fails.
        });
      return;
    }

    navigator.serviceWorker.register("/sw.js")
      .then(registration => {
        registration.update().catch(() => {
          // Silent: share target should still work even if the update check fails.
        });

        let reloading = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (reloading) return;
          reloading = true;
          window.location.reload();
        });
      })
      .catch(() => {
        // Silent: direct import should fail gracefully back to manual upload.
      });
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
