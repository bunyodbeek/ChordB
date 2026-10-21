import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { usePath } from "./router";
import "./styles.css";
import { initTelegram } from "./telegram";
import { t } from "./texts";

// Admins only: kept out of the Mini App's bundle.
const Panel = lazy(() => import("./panel/Panel"));

initTelegram();

function Root() {
  const path = usePath();
  if (path === "/admin" || path.startsWith("/admin/")) {
    return (
      <Suspense fallback={<div className="center muted">{t.loading}</div>}>
        <Panel />
      </Suspense>
    );
  }
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
