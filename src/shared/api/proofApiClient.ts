import { BitcoinNetwork } from "../bitcoin/networks";

export const POW_API_BASE = (import.meta.env.VITE_POW_API_BASE ?? "")
  .trim()
  .replace(/\/+$/u, "");

type ProofApiErrorOptions = {
  code?: string;
  status: number;
  timedOut?: boolean;
};

export class ProofApiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly timedOut: boolean;

  constructor(message: string, options: ProofApiErrorOptions) {
    super(message);
    this.name = "ProofApiRequestError";
    this.code = options.code ?? "";
    this.status = options.status;
    this.timedOut = options.timedOut === true;
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function proofApiResponseError(responseText: string, status: number) {
  let payload: Record<string, unknown> | null = null;
  try {
    payload = objectValue(JSON.parse(responseText));
  } catch {
    // A non-JSON proxy or network response still gets a useful HTTP fallback.
  }
  const details = objectValue(payload?.details);
  const message =
    stringValue(payload?.error) ||
    stringValue(details?.error) ||
    responseText.trim() ||
    `ProofOfWork API returned ${status}.`;
  return new ProofApiRequestError(message, {
    code: stringValue(details?.code) || stringValue(payload?.code),
    status,
    timedOut: details?.timedOut === true || payload?.timedOut === true,
  });
}

export function isTransientProofApiReadError(error: unknown) {
  if (error instanceof ProofApiRequestError) {
    return (
      error.code === "CANONICAL_INDEX_UNAVAILABLE" ||
      error.code === "CANONICAL_SUMMARY_UNAVAILABLE" ||
      error.status === 502 ||
      error.status === 504
    );
  }

  return (
    error instanceof Error &&
    (/Failed to fetch/iu.test(error.message) ||
      /ProofOfWork API refresh took too long/iu.test(error.message))
  );
}

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
    throw proofApiResponseError(responseText, response.status);
  }

  return response.json() as Promise<T>;
}
