export type ExactIntegerValue = bigint | number | string;

const UNSIGNED_INTEGER_PATTERN = /^(?:0|[1-9]\d*)$/u;
const SIGNED_INTEGER_PATTERN = /^-?(?:0|[1-9]\d*)$/u;
const UNSIGNED_DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/u;
const Q8_SCALE = 100_000_000n;
const PLAIN_DECIMAL_FORMAT = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 20,
  useGrouping: false,
});

export function exactIntegerBigInt(
  value: unknown,
  options: { signed?: boolean } = {},
): bigint | null {
  if (typeof value === "bigint") {
    return options.signed || value >= 0n ? value : null;
  }

  if (typeof value === "number") {
    return Number.isSafeInteger(value) && (options.signed || value >= 0)
      ? BigInt(value)
      : null;
  }

  const text = typeof value === "string" ? value.trim() : "";
  const pattern = options.signed ? SIGNED_INTEGER_PATTERN : UNSIGNED_INTEGER_PATTERN;
  return pattern.test(text) ? BigInt(text) : null;
}

export function exactIntegerText(
  value: unknown,
  options: { signed?: boolean } = {},
) {
  return exactIntegerBigInt(value, options)?.toString() ?? "";
}

export function exactIntegerNumber(value: unknown) {
  const exact = exactIntegerBigInt(value);
  if (exact !== null) {
    return Number(exact);
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : 0;
}

export function exactDecimalText(value: unknown) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      return "";
    }
    const formatted = PLAIN_DECIMAL_FORMAT.format(value);
    return UNSIGNED_DECIMAL_PATTERN.test(formatted) ? formatted : "";
  }
  const text = typeof value === "string" ? value.trim() : "";
  return UNSIGNED_DECIMAL_PATTERN.test(text) ? text : "";
}

export function exactDecimalNumber(value: unknown) {
  const text = exactDecimalText(value);
  return text ? Number(text) : 0;
}

export function compareExactIntegers(left: unknown, right: unknown) {
  const leftExact = exactIntegerBigInt(left, { signed: true });
  const rightExact = exactIntegerBigInt(right, { signed: true });
  if (leftExact !== null && rightExact !== null) {
    return leftExact < rightExact ? -1 : leftExact > rightExact ? 1 : 0;
  }
  return exactIntegerNumber(left) - exactIntegerNumber(right);
}

export function formatExactInteger(value: unknown) {
  const exact = exactIntegerBigInt(value, { signed: true });
  if (exact !== null) {
    return exact.toLocaleString("en-US");
  }

  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.floor(numeric).toLocaleString("en-US")
    : "0";
}

export function formatExactDecimal(
  value: unknown,
  options: { maximumFractionDigits?: number } = {},
) {
  const canonical = exactDecimalText(value);
  if (!canonical) {
    return "0";
  }
  const [whole, fraction = ""] = canonical.split(".");
  const maximumFractionDigits = Math.max(
    0,
    Math.floor(options.maximumFractionDigits ?? fraction.length),
  );
  const visibleFraction = fraction
    .slice(0, maximumFractionDigits)
    .replace(/0+$/u, "");
  const grouped = BigInt(whole).toLocaleString("en-US");
  return visibleFraction ? `${grouped}.${visibleFraction}` : grouped;
}

function groupedWhole(value: bigint) {
  return value.toLocaleString("en-US");
}

export function formatExactQ8(
  value: unknown,
  options: { maximumFractionDigits?: number } = {},
) {
  const exact = exactIntegerBigInt(value, { signed: true });
  if (exact === null) {
    return "";
  }

  const maximumFractionDigits = Math.max(
    0,
    Math.min(8, Math.floor(options.maximumFractionDigits ?? 8)),
  );
  const negative = exact < 0n;
  const absolute = negative ? -exact : exact;
  const whole = absolute / Q8_SCALE;
  const fraction = (absolute % Q8_SCALE).toString().padStart(8, "0");
  const visibleFraction = fraction
    .slice(0, maximumFractionDigits)
    .replace(/0+$/u, "");
  const formatted = visibleFraction
    ? `${groupedWhole(whole)}.${visibleFraction}`
    : groupedWhole(whole);
  return negative ? `-${formatted}` : formatted;
}

export function exactQ8Number(value: unknown) {
  const exact = exactIntegerBigInt(value, { signed: true });
  return exact === null ? 0 : Number(exact) / Number(Q8_SCALE);
}
