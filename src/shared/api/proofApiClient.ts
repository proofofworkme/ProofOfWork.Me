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
  const response = await fetch(proofApiUrl(path, network), {
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    throw new Error(
      responseText || `ProofOfWork API returned ${response.status}.`,
    );
  }

  return response.json() as Promise<T>;
}
