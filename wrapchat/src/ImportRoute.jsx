import { useCallback, useEffect, useRef, useState } from "react";
import BrandLockup from "./BrandLockup";
import { processImportedChatFile } from "./import/fileProcessing";
import {
  clearSharedFileFromServiceWorker,
  requestSharedFileFromServiceWorker,
  subscribeToShareTargetEvents,
} from "./import/shareTargetClient";

const PANEL_STYLE = {
  minHeight: "100vh",
  background: "radial-gradient(circle at top, #1f3245 0%, #0c1520 48%, #060b11 100%)",
  color: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "28px 18px",
};

const CARD_STYLE = {
  width: "100%",
  maxWidth: 460,
  background: "rgba(4, 10, 16, 0.72)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 28,
  padding: 24,
  boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
  backdropFilter: "blur(14px)",
};

function Dots() {
  return (
    <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 18 }}>
      {[0, 1, 2].map(index => (
        <div
          key={index}
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.7)",
            animation: `blink 1.2s ${index * 0.18}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

function UploadFallback({ onFile, busy }) {
  const inputId = "wrapchat-import-input";

  return (
    <>
      <label
        htmlFor={inputId}
        onDragOver={event => event.preventDefault()}
        onDrop={event => {
          event.preventDefault();
          onFile(event.dataTransfer.files?.[0] || null);
        }}
        style={{
          marginTop: 18,
          display: "block",
          width: "100%",
          borderRadius: 24,
          border: "1px dashed rgba(255,255,255,0.24)",
          background: "rgba(255,255,255,0.05)",
          padding: "28px 18px",
          textAlign: "center",
          cursor: busy ? "default" : "pointer",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.3 }}>
          {busy ? "Opening your chat..." : "Choose your chat export"}
        </div>
        <div style={{ marginTop: 10, fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.65 }}>
          Share your WhatsApp export here, or drop the file on this card.
        </div>
      </label>

      <input
        id={inputId}
        type="file"
        accept=".txt,.zip,text/plain,application/zip"
        style={{ display: "none" }}
        onChange={event => onFile(event.target.files?.[0] || null)}
      />
    </>
  );
}

export default function ImportRoute({ onComplete, onCancel }) {
  const [statusText, setStatusText] = useState("Opening your chat...");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [summary, setSummary] = useState(null);
  const completionTimerRef = useRef(null);
  const startedRef = useRef(false);

  const processFile = useCallback(async (file, source = "manual") => {
    if (!file || startedRef.current) return;
    startedRef.current = true;
    setBusy(true);
    setError("");
    setSummary(null);

    try {
      const result = await processImportedChatFile(file, {
        onStatus: update => setStatusText(update.message),
      });

      setSummary(result.summary);
      setStatusText(`Found ${result.summary.messageCount.toLocaleString()} messages with ${result.summary.participantLabel}.`);
      setBusy(false);
      if (source === "shared") await clearSharedFileFromServiceWorker();

      completionTimerRef.current = window.setTimeout(() => {
        onComplete(result.payload);
      }, 900);
    } catch (processingError) {
      if (source === "shared") await clearSharedFileFromServiceWorker();
      setError(String(processingError?.message || "We couldn't open that chat."));
      setBusy(false);
      startedRef.current = false;
      setStatusText("Opening your chat...");
    }
  }, [onComplete]);

  useEffect(() => {
    let active = true;

    const tryPendingShare = async () => {
      const sharedFile = await requestSharedFileFromServiceWorker();
      if (!active) return;
      if (sharedFile) {
        processFile(sharedFile, "shared");
      } else {
        setBusy(false);
        setStatusText("Opening your chat...");
      }
    };

    tryPendingShare();

    const unsubscribe = subscribeToShareTargetEvents(async event => {
      if (event?.type === "WRAPCHAT_SHARE_READY" && !startedRef.current) {
        const sharedFile = await requestSharedFileFromServiceWorker();
        if (sharedFile) processFile(sharedFile, "shared");
      }
    });

    return () => {
      active = false;
      unsubscribe();
      if (completionTimerRef.current) window.clearTimeout(completionTimerRef.current);
    };
  }, [processFile]);

  return (
    <div style={PANEL_STYLE}>
      <style>{`
        @keyframes blink {
          0%, 80%, 100% { opacity: 0.25; transform: scale(0.9); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
      <div style={CARD_STYLE}>
        <BrandLockup
          titleSize={42}
          titleLetterSpacing={-2.4}
          subtitle="Your chat, ready to read."
        />

        <div
          style={{
            marginTop: 22,
            borderRadius: 24,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.08)",
            padding: "22px 18px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.4 }}>{statusText}</div>
          {busy && <Dots />}

          {summary && (
            <div style={{ marginTop: 18, textAlign: "left", lineHeight: 1.75 }}>
              <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.45)" }}>
                Chat found
              </div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{summary.participantLabel}</div>
              <div style={{ marginTop: 8, fontSize: 14, color: "rgba(255,255,255,0.75)" }}>
                {summary.messageCount.toLocaleString()} messages
              </div>
              <div style={{ fontSize: 14, color: "rgba(255,255,255,0.75)" }}>{summary.dateRangeLabel}</div>
            </div>
          )}
        </div>

        {!busy && !summary && (
          <>
            <div style={{ marginTop: 18, fontSize: 13, color: "rgba(255,255,255,0.62)", lineHeight: 1.7, textAlign: "center" }}>
              If sharing didn&apos;t bring the export in automatically, you can choose it here instead.
            </div>
            <UploadFallback onFile={file => processFile(file, "manual")} busy={busy} />
          </>
        )}

        {error && (
          <div
            style={{
              marginTop: 16,
              background: "rgba(200,60,20,0.18)",
              border: "1px solid rgba(255,160,120,0.2)",
              color: "#ffcfbf",
              borderRadius: 18,
              padding: "12px 14px",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ marginTop: 18, display: "flex", justifyContent: "center" }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              border: "1px solid rgba(255,255,255,0.16)",
              borderRadius: 999,
              background: "rgba(255,255,255,0.07)",
              color: "#fff",
              padding: "10px 16px",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Back to WrapChat
          </button>
        </div>
      </div>
    </div>
  );
}
