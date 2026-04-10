import { useEffect, useState } from "react";
import App from "./App";
import ImportRoute from "./ImportRoute";

function createImportToken() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function Root() {
  const [path, setPath] = useState(() => window.location.pathname);
  const [pendingImportedChat, setPendingImportedChat] = useState(null);

  useEffect(() => {
    const handleNavigation = () => setPath(window.location.pathname);
    window.addEventListener("popstate", handleNavigation);
    return () => window.removeEventListener("popstate", handleNavigation);
  }, []);

  const goHome = () => {
    window.history.replaceState({}, "", "/");
    setPath("/");
  };

  if (path === "/import") {
    return (
      <ImportRoute
        onComplete={payload => {
          setPendingImportedChat({ id: createImportToken(), payload });
          goHome();
        }}
        onCancel={goHome}
      />
    );
  }

  return (
    <App
      pendingImportedChat={pendingImportedChat}
      onPendingImportedChatConsumed={token => {
        setPendingImportedChat(current => (current?.id === token ? null : current));
      }}
    />
  );
}
