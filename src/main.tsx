import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { detectAppSurface } from "./app/routeRegistry";
import { AppErrorBoundary } from "./shared/components/AppErrorBoundary";
import "./styles.css";

const RootApp =
  detectAppSurface() === "landing"
    ? lazy(() => import("./features/landing/LandingRoot"))
    : lazy(() => import("./App"));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <Suspense fallback={<div role="status">Loading ProofOfWork.Me…</div>}>
        <RootApp />
      </Suspense>
    </AppErrorBoundary>
  </React.StrictMode>,
);
