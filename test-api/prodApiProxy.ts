import type { ProxyOptions } from "vite";

export const TEST_API_PREFIX = "/test-api";
export const PROD_PROOF_API_ORIGIN = "https://computer.proofofwork.me";

export function prodProofApiProxy(): Record<string, string | ProxyOptions> {
  return {
    "/api": {
      changeOrigin: true,
      secure: true,
      target: PROD_PROOF_API_ORIGIN,
    },
    [TEST_API_PREFIX]: {
      changeOrigin: true,
      secure: true,
      target: PROD_PROOF_API_ORIGIN,
      rewrite: (path) => path.replace(new RegExp(`^${TEST_API_PREFIX}`), ""),
    },
  };
}
