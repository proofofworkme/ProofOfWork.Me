import { posix } from "node:path";
import { execFileSync } from "node:child_process";
import type { Connect, Plugin, ProxyOptions } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { prodProofApiProxy } from "./test-api/prodApiProxy";

const LOCAL_PROOF_API_ORIGIN = "http://127.0.0.1:8081";

const PAGES_RUNNER_CSP = "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'; form-action 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data: blob:; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; manifest-src 'none'; sandbox allow-scripts";

function pagesRunnerHeaders(): Plugin {
  const install = (server: { middlewares: Connect.Server }) => {
    server.middlewares.use((request, response, next) => {
      let path;
      try {
        path = posix.normalize(decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname));
      } catch {
        next();
        return;
      }
      if (path === "/pages-runner.html") {
        response.setHeader("Content-Security-Policy", PAGES_RUNNER_CSP);
        response.setHeader("X-Frame-Options", "SAMEORIGIN");
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Referrer-Policy", "no-referrer");
        response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
      }
      next();
    });
  };
  return {
    name: "proof-pages-runner-headers",
    configureServer: install,
    configurePreviewServer: install,
  };
}

function releaseSourceProvenance(): Plugin {
  return {
    name: "proof-release-source-provenance",
    apply: "build",
    generateBundle() {
      const git = (...args: string[]) => execFileSync("git", args, { cwd: process.cwd(), encoding: "utf8" }).trim();
      const commit = git("rev-parse", "HEAD");
      const tree = git("rev-parse", "HEAD^{tree}");
      if (!/^[a-f0-9]{40}$/.test(commit) || !/^[a-f0-9]{40}$/.test(tree)) throw new Error("Build requires exact Git source provenance.");
      this.emitFile({ type: "asset", fileName: "source-provenance.json", source: JSON.stringify({
        format: "proof-of-work-ui-source-v1", commit, tree,
        trackedDirty: Boolean(git("status", "--porcelain", "--untracked-files=no")),
      }) + "\n" });
    },
  };
}

function localProofApiProxy(): Record<string, string | ProxyOptions> {
  return {
    "/api": {
      changeOrigin: true,
      secure: false,
      target: LOCAL_PROOF_API_ORIGIN,
    },
  };
}

export default defineConfig(({ mode }) => ({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }

          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("/node_modules/scheduler/") ||
            id.includes("/node_modules/lucide-react/")
          ) {
            return "react";
          }

          if (
            id.includes("bitcoinjs-lib") ||
            id.includes("@bitcoinerlab") ||
            id.includes("ecpair") ||
            id.includes("tiny-secp256k1") ||
            id.includes("bip")
          ) {
            return "proofofwork";
          }

          return undefined;
        },
      },
    },
  },
  plugins: [react(), pagesRunnerHeaders(), releaseSourceProvenance()],
  server: {
    proxy:
      mode === "prod-api"
        ? {
            ...localProofApiProxy(),
            ...prodProofApiProxy(),
          }
        : localProofApiProxy(),
  },
}));
