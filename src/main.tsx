import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/space-grotesk/wght.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-700.css";
import { detectAppSurface } from "./app/routeRegistry";
import { AppErrorBoundary } from "./shared/components/AppErrorBoundary";
import "./styles.css";

const appSurface = detectAppSurface();
const RootApp =
  detectAppSurface() === "landing"
    ? lazy(() => import("./features/landing/LandingRoot"))
    : appSurface === "boost"
      ? lazy(() => import("./features/boost/BoostRoot"))
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
