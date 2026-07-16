export const WORK_TOKEN_ID =
  "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
export const WORK_DECIMALS = 8;
export const WORK_UNIT_SCALE = 100_000_000n;
export const WORK_UNIT_SCALE_TEXT = WORK_UNIT_SCALE.toString();
export const WORK_ATOMIC_PROJECTION_MODEL = "work-atoms-v1";
export const WORK_VALUE_Q8_SCALE = 100_000_000n;

export function isWorkTokenId(value) {
  return String(value ?? "").trim().toLowerCase() === WORK_TOKEN_ID;
}

export function normalizeWorkAtoms(
  value,
  { allowNegative = false, allowZero = false } = {},
) {
  let text;
  if (typeof value === "bigint") {
    text = value.toString();
  } else if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError("WORK atoms must be an exact safe integer.");
    }
    text = String(value);
  } else {
    text = String(value ?? "").trim();
  }

  const pattern = allowNegative
    ? /^-?(?:0|[1-9]\d*)$/u
    : /^(?:0|[1-9]\d*)$/u;
  if (!pattern.test(text)) {
    throw new TypeError("WORK atoms must be a canonical integer.");
  }
  const atoms = BigInt(text);
  if (atoms === 0n && text.startsWith("-")) {
    throw new TypeError("WORK atoms cannot use a negative-zero alias.");
  }
  if (!allowNegative && atoms < 0n) {
    throw new RangeError("WORK atoms cannot be negative.");
  }
  if (!allowZero && atoms === 0n) {
    throw new RangeError("WORK atoms must be greater than zero.");
  }
  return atoms.toString();
}

export function isCanonicalWorkAtoms(value, options = {}) {
  try {
    return normalizeWorkAtoms(value, options) === String(value ?? "").trim();
  } catch {
    return false;
  }
}

export function parseWorkAmountToAtoms(
  value,
  { allowZero = false, maxAtoms = "" } = {},
) {
  let text;
  if (typeof value === "bigint") {
    text = value.toString();
  } else if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("WORK amount must be a finite decimal.");
    }
    text = String(value);
  } else {
    text = String(value ?? "").trim();
  }

  const match =
    /^(0|[1-9]\d*)(?:\.(\d{1,8}))?$/u.exec(text);
  if (!match) {
    throw new TypeError(
      "WORK amount must be a plain decimal with at most 8 places.",
    );
  }
  const whole = BigInt(match[1]);
  const fractional = String(match[2] ?? "").padEnd(
    WORK_DECIMALS,
    "0",
  );
  const atoms = whole * WORK_UNIT_SCALE + BigInt(fractional || "0");
  if (!allowZero && atoms === 0n) {
    throw new RangeError("WORK amount must be greater than zero.");
  }
  if (maxAtoms !== "") {
    const normalizedMax = BigInt(
      normalizeWorkAtoms(maxAtoms, { allowZero: true }),
    );
    if (atoms > normalizedMax) {
      throw new RangeError("WORK amount exceeds the allowed atomic maximum.");
    }
  }
  return atoms.toString();
}

export function tryParseWorkAmountToAtoms(value, options = {}) {
  try {
    return parseWorkAmountToAtoms(value, options);
  } catch {
    return "";
  }
}

export function parseSignedWorkAmountToAtoms(value) {
  const text = String(value ?? "").trim();
  const match =
    /^(-?)(0|[1-9]\d*)(?:\.(\d{1,8}))?$/u.exec(text);
  if (!match) {
    throw new TypeError(
      "Signed WORK amount must be a canonical decimal with at most 8 places.",
    );
  }
  const whole = BigInt(match[2]);
  const fractional = BigInt(
    String(match[3] ?? "").padEnd(WORK_DECIMALS, "0") || "0",
  );
  const absoluteAtoms = whole * WORK_UNIT_SCALE + fractional;
  if (match[1] === "-" && absoluteAtoms === 0n) {
    throw new TypeError("Signed WORK amount cannot use negative zero.");
  }
  return (match[1] === "-" ? -absoluteAtoms : absoluteAtoms).toString();
}

export function tryParseSignedWorkAmountToAtoms(value) {
  try {
    return parseSignedWorkAmountToAtoms(value);
  } catch {
    return "";
  }
}

export function formatWorkAtoms(
  value,
  { allowNegative = false, trim = true } = {},
) {
  const atomsText = normalizeWorkAtoms(value, {
    allowNegative,
    allowZero: true,
  });
  const negative = atomsText.startsWith("-");
  const absolute = BigInt(negative ? atomsText.slice(1) : atomsText);
  const whole = absolute / WORK_UNIT_SCALE;
  const fraction = String(absolute % WORK_UNIT_SCALE).padStart(
    WORK_DECIMALS,
    "0",
  );
  const displayedFraction = trim ? fraction.replace(/0+$/u, "") : fraction;
  const amount = displayedFraction
    ? `${whole}.${displayedFraction}`
    : whole.toString();
  return negative && absolute !== 0n ? `-${amount}` : amount;
}

export function workAmountAtomsFromRecord(
  record,
  { allowZero = false, storedAmountIsAtoms = false } = {},
) {
  const item =
    record && typeof record === "object" && !Array.isArray(record)
      ? record
      : {};
  const saleAuthorization =
    item.saleAuthorization &&
    typeof item.saleAuthorization === "object" &&
    !Array.isArray(item.saleAuthorization)
      ? item.saleAuthorization
      : {};
  const explicitAtoms = [
    item.amountAtoms,
    item.tokenAmountAtoms,
    saleAuthorization.amountAtoms,
  ].find(
    (candidate) =>
      candidate !== undefined && candidate !== null && candidate !== "",
  );
  if (explicitAtoms !== undefined) {
    return normalizeWorkAtoms(explicitAtoms, { allowZero });
  }

  const amount = [
    item.amount,
    item.tokenAmount,
    saleAuthorization.amount,
  ].find(
    (candidate) =>
      candidate !== undefined && candidate !== null && candidate !== "",
  );
  if (amount === undefined) {
    throw new TypeError("WORK amount is missing.");
  }
  return storedAmountIsAtoms
    ? normalizeWorkAtoms(amount, { allowZero })
    : parseWorkAmountToAtoms(amount, { allowZero });
}

export function workAmountFields(record, options = {}) {
  const amountAtoms = workAmountAtomsFromRecord(record, options);
  return {
    amount: formatWorkAtoms(amountAtoms),
    amountAtoms,
    decimals: WORK_DECIMALS,
    unitScale: WORK_UNIT_SCALE_TEXT,
  };
}

export function withWorkPrecisionMetadata(metadata = {}) {
  const source =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? metadata
      : {};
  return {
    ...source,
    amountStorageModel: WORK_ATOMIC_PROJECTION_MODEL,
    decimals: WORK_DECIMALS,
    unitScale: WORK_UNIT_SCALE_TEXT,
  };
}

export function decimalValueToQ8(value) {
  let text = String(value ?? "").trim();
  if (!/^[+]?[0-9]+(?:\.[0-9]+)?$/u.test(text)) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
      return null;
    }
    text = number.toFixed(8);
  }
  text = text.replace(/^\+/u, "");
  const [whole = "0", fractional = ""] = text.split(".");
  if (!/^[0-9]+$/u.test(whole) || !/^[0-9]*$/u.test(fractional)) {
    return null;
  }
  const rounded = `${whole}${fractional.padEnd(8, "0").slice(0, 8)}`;
  return BigInt(rounded || "0");
}

export function q8ToCanonicalDecimal(value) {
  const q8 = typeof value === "bigint" ? value : BigInt(value);
  const sign = q8 < 0n ? "-" : "";
  const absolute = q8 < 0n ? -q8 : q8;
  const whole = absolute / WORK_VALUE_Q8_SCALE;
  const fractional = absolute % WORK_VALUE_Q8_SCALE;
  if (fractional === 0n) {
    return `${sign}${whole.toString()}`;
  }
  return `${sign}${whole.toString()}.${fractional
    .toString()
    .padStart(8, "0")
    .replace(/0+$/u, "")}`;
}

export function q8ToNumber(value) {
  return Number(q8ToCanonicalDecimal(value));
}

export function workAtomsValueAtFloorQ8(amountAtoms, floorValue) {
  const atoms =
    typeof amountAtoms === "bigint" ? amountAtoms : BigInt(amountAtoms);
  const floorValueQ8 = decimalValueToQ8(floorValue);
  if (atoms < 0n || floorValueQ8 === null || floorValueQ8 < 0n) {
    return null;
  }
  return (atoms * floorValueQ8) / WORK_UNIT_SCALE;
}
