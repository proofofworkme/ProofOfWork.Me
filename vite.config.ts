import type { ProxyOptions } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { prodProofApiProxy } from "./test-api/prodApiProxy";

const LOCAL_PROOF_API_ORIGIN = "http://127.0.0.1:8081";

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

          if (id.includes("/node_modules/lucide-react/")) {
            return "icons";
          }

          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("/node_modules/scheduler/")
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
  plugins: [react()],
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
