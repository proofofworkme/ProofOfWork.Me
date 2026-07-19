export const BOND_VALUE_Q8_SCALE = 100_000_000n;

export function canonicalIntegerText(
  value,
  { allowNegative = false, allowZero = true } = {},
) {
  if (typeof value === "bigint") {
    if (!allowNegative && value < 0n) return "";
    if (!allowZero && value === 0n) return "";
    return value.toString();
  }

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) return "";
    if (!allowNegative && value < 0) return "";
    if (!allowZero && value === 0) return "";
    return String(value);
  }

  const text = String(value ?? "").trim();
  const pattern = allowNegative
    ? /^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/u
    : /^(?:0|[1-9][0-9]*)$/u;
  if (!pattern.test(text)) return "";
  if (!allowZero && text === "0") return "";
  return BigInt(text).toString();
}

export function integerBigInt(value, options = {}) {
  const text = canonicalIntegerText(value, options);
  return text ? BigInt(text) : null;
}

export function addIntegerTexts(left, right) {
  const leftInteger = integerBigInt(left, { allowNegative: true });
  const rightInteger = integerBigInt(right, { allowNegative: true });
  if (leftInteger === null || rightInteger === null) return "";
  return (leftInteger + rightInteger).toString();
}

export function maxIntegerTexts(left, right) {
  const leftInteger = integerBigInt(left, { allowNegative: true });
  const rightInteger = integerBigInt(right, { allowNegative: true });
  if (leftInteger === null || rightInteger === null) return "";
  return (leftInteger >= rightInteger ? leftInteger : rightInteger).toString();
}

export function safeIntegerNumber(value) {
  const text = canonicalIntegerText(value, { allowNegative: true });
  if (!text) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) ? number : null;
}

export function q8TextFromIntegerUnits(value) {
  const integer = integerBigInt(value, { allowNegative: true });
  return integer === null
    ? ""
    : (integer * BOND_VALUE_Q8_SCALE).toString();
}

export function decimalTextFromQ8(value, { trim = true } = {}) {
  const q8 = integerBigInt(value, { allowNegative: true });
  if (q8 === null) return "";
  const negative = q8 < 0n;
  const absolute = negative ? -q8 : q8;
  const whole = absolute / BOND_VALUE_Q8_SCALE;
  const fraction = (absolute % BOND_VALUE_Q8_SCALE)
    .toString()
    .padStart(8, "0");
  const fractional = trim ? fraction.replace(/0+$/u, "") : fraction;
  return `${negative ? "-" : ""}${whole.toString()}${
    fractional ? `.${fractional}` : ""
  }`;
}

export function q8TextFromDecimal(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return "";
    // Binary floating-point is compatibility input only. It is accepted here
    // solely when its fixed Q8 rendering round-trips to the same number.
    const fixed = value.toFixed(8);
    if (Number(fixed) !== value) return "";
    value = fixed;
  }
  const text = String(value ?? "").trim();
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,8}))?$/u.exec(text);
  if (!match) return "";
  return BigInt(`${match[1]}${(match[2] ?? "").padEnd(8, "0")}`).toString();
}

export function floorQ8PerUnit(totalValueQ8, supplyUnits) {
  const total = integerBigInt(totalValueQ8);
  const supply = integerBigInt(supplyUnits, { allowZero: false });
  if (total === null || supply === null) return "0";
  return (total / supply).toString();
}

export function exactOrApproximateNumber(value) {
  const text = canonicalIntegerText(value, { allowNegative: true });
  if (!text) return { approximate: null, exact: "", safe: null };
  const safe = safeIntegerNumber(text);
  return {
    approximate: safe === null ? Number(text) : safe,
    exact: text,
    safe,
  };
}
