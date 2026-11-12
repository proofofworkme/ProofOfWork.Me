// Presentation only. Never use a formatted approximation for protocol arithmetic.
export function growthMagnitude(value) {
  if (!Number.isFinite(value)) return "Unavailable";
  return new Intl.NumberFormat("en-US", {
    notation: Math.abs(value) >= 1e15 ? "scientific" : "compact",
    maximumSignificantDigits: 4,
  }).format(value);
}
