import { BitcoinNetwork } from "../bitcoin/networks";

export const POW_API_BASE = (import.meta.env.VITE_POW_API_BASE ?? "")
  .trim()
  .replace(/\/+$/u, "");

export function proofApiUrl(path: string, network: BitcoinNetwork) {
  const separator = path.includes("?") ? "&" : "?";
  return `${POW_API_BASE}${path}${separator}network=${encodeURIComponent(network)}`;
}

export async function fetchProofApiJson<T>(
  path: string,
  network: BitcoinNetwork,
): Promise<T> {
  const url = proofApiUrl(path, network);
  const isFreshRead = /(?:[?&](?:fresh|refresh|nocache)=)/u.test(url);
  const isAddressMailRead = /^\/api\/v1\/address\/[^/]+\/mail(?:[?&]|$)/u.test(
    path,
  );
  const controller = new AbortController();
  let timedOut = false;
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, isAddressMailRead ? 180_000 : 60_000);

  let response: Response;
  try {
    response = await fetch(url, {
      cache: isFreshRead ? "no-store" : "default",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (
      timedOut ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      throw new Error(
        "ProofOfWork API refresh took too long. Showing the latest indexed data when available; refresh again in a moment.",
      );
    }

    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    throw new Error(
      responseText || `ProofOfWork API returned ${response.status}.`,
    );
  }

  return response.json() as Promise<T>;
}
