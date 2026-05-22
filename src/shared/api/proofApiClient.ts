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
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 60_000);

  let response: Response;
  try {
    response = await fetch(url, {
      cache: isFreshRead ? "no-store" : "default",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });
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
