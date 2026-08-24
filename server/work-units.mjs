export const WORK_TOKEN_ID =
  "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
export const WORK_DECIMALS = 8;
export const WORK_UNIT_SCALE = 100_000_000n;
export const WORK_UNIT_SCALE_TEXT = WORK_UNIT_SCALE.toString();
export const WORK_LEGACY_DECIMALS = WORK_DECIMALS;
export const WORK_LEGACY_UNIT_SCALE = WORK_UNIT_SCALE;
export const WORK_LEGACY_UNIT_SCALE_TEXT = WORK_UNIT_SCALE_TEXT;
export const WORK_LEGACY_ATOMIC_PROJECTION_MODEL = "work-atoms-v1";
export const WORK_SUBATOM_DECIMALS = 16;
export const WORK_SUBATOM_UNIT_SCALE = 10_000_000_000_000_000n;
export const WORK_SUBATOM_UNIT_SCALE_TEXT =
  WORK_SUBATOM_UNIT_SCALE.toString();
export const WORK_SUBATOM_CONVERSION_FACTOR =
  WORK_SUBATOM_UNIT_SCALE / WORK_LEGACY_UNIT_SCALE;
export const WORK_SUBATOM_PROJECTION_MODEL = "work-subatoms-v2";
export const WORK_PRECISION_V2_MODEL = "canonical-work-subatoms-v2";
export const WORK_PRECISION_V2_MIGRATION_MODEL =
  "canonical-work-q8-to-q16-migration-v1";
export const WORK_PRECISION_V2_MIGRATION_META_KEY =
  "workPrecisionV2Migration:livenet";
// V6 remains an immutable Q8 protocol. V7 and later use the Q16 constants
// above after the separately evidenced precision migration activates.
export const WORK_AMO_DECIMALS = WORK_LEGACY_DECIMALS;
export const WORK_AMO_UNIT_SCALE = WORK_LEGACY_UNIT_SCALE;
export const WORK_AMO_UNIT_SCALE_TEXT = WORK_AMO_UNIT_SCALE.toString();
export const WORK_ATOMIC_PROJECTION_MODEL =
  WORK_LEGACY_ATOMIC_PROJECTION_MODEL;
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

export function normalizeWorkSubatoms(value, options = {}) {
  if (
    typeof value === "string" &&
    value !== value.trim()
  ) {
    throw new TypeError(
      "WORK subatoms must not use surrounding whitespace.",
    );
  }
  return normalizeWorkAtoms(value, options);
}

export function isCanonicalWorkSubatoms(value, options = {}) {
  try {
    return (
      normalizeWorkSubatoms(value, options) ===
      String(value ?? "").trim()
    );
  } catch {
    return false;
  }
}

export function legacyWorkAtomsToSubatoms(
  value,
  { allowNegative = false, allowZero = false } = {},
) {
  const legacyAtoms = BigInt(
    normalizeWorkAtoms(value, {
      allowNegative,
      allowZero,
    }),
  );
  return (legacyAtoms * WORK_SUBATOM_CONVERSION_FACTOR).toString();
}

export function workSubatomsToLegacyAtoms(
  value,
  {
    allowNegative = false,
    allowZero = false,
    requireExact = true,
  } = {},
) {
  const subatoms = BigInt(
    normalizeWorkSubatoms(value, {
      allowNegative,
      allowZero,
    }),
  );
  if (
    requireExact &&
    subatoms % WORK_SUBATOM_CONVERSION_FACTOR !== 0n
  ) {
    throw new RangeError(
      "WORK subatoms do not map exactly to the legacy atomic scale.",
    );
  }
  return (subatoms / WORK_SUBATOM_CONVERSION_FACTOR).toString();
}

function parseWorkDecimalToUnits(
  value,
  {
    allowZero = false,
    decimals,
    maxUnits = "",
    trimInput = true,
    unitLabel,
    unitScale,
  },
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
    text = String(value ?? "");
    if (!trimInput && text !== text.trim()) {
      throw new TypeError(
        `WORK ${unitLabel} amount must not use surrounding whitespace.`,
      );
    }
    text = trimInput ? text.trim() : text;
  }

  const match = new RegExp(
    `^(0|[1-9]\\d*)(?:\\.(\\d{1,${decimals}}))?$`,
    "u",
  ).exec(text);
  if (!match) {
    throw new TypeError(
      `WORK amount must be a plain decimal with at most ${decimals} places.`,
    );
  }
  const whole = BigInt(match[1]);
  const fractional = String(match[2] ?? "").padEnd(decimals, "0");
  const units = whole * unitScale + BigInt(fractional || "0");
  if (!allowZero && units === 0n) {
    throw new RangeError("WORK amount must be greater than zero.");
  }
  if (maxUnits !== "") {
    const normalizedMax = BigInt(
      unitScale === WORK_SUBATOM_UNIT_SCALE
        ? normalizeWorkSubatoms(maxUnits, { allowZero: true })
        : normalizeWorkAtoms(maxUnits, { allowZero: true }),
    );
    if (units > normalizedMax) {
      throw new RangeError(
        `WORK amount exceeds the allowed ${unitLabel} maximum.`,
      );
    }
  }
  return units.toString();
}

export function parseWorkAmountToAtoms(
  value,
  { allowZero = false, maxAtoms = "" } = {},
) {
  return parseWorkDecimalToUnits(value, {
    allowZero,
    decimals: WORK_LEGACY_DECIMALS,
    maxUnits: maxAtoms,
    unitLabel: "atomic",
    unitScale: WORK_LEGACY_UNIT_SCALE,
  });
}

export function parseWorkAmountToSubatoms(
  value,
  { allowZero = false, maxSubatoms = "" } = {},
) {
  return parseWorkDecimalToUnits(value, {
    allowZero,
    decimals: WORK_SUBATOM_DECIMALS,
    maxUnits: maxSubatoms,
    trimInput: false,
    unitLabel: "subatomic",
    unitScale: WORK_SUBATOM_UNIT_SCALE,
  });
}

export function tryParseWorkAmountToAtoms(value, options = {}) {
  try {
    return parseWorkAmountToAtoms(value, options);
  } catch {
    return "";
  }
}

export function tryParseWorkAmountToSubatoms(value, options = {}) {
  try {
    return parseWorkAmountToSubatoms(value, options);
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

export function parseSignedWorkAmountToSubatoms(value) {
  const text = String(value ?? "");
  if (text !== text.trim()) {
    throw new TypeError(
      "Signed WORK subatom amount must not use surrounding whitespace.",
    );
  }
  const match =
    /^(-?)(0|[1-9]\d*)(?:\.(\d{1,16}))?$/u.exec(text);
  if (!match) {
    throw new TypeError(
      "Signed WORK amount must be a canonical decimal with at most 16 places.",
    );
  }
  const whole = BigInt(match[2]);
  const fractional = BigInt(
    String(match[3] ?? "").padEnd(WORK_SUBATOM_DECIMALS, "0") ||
      "0",
  );
  const absoluteSubatoms =
    whole * WORK_SUBATOM_UNIT_SCALE + fractional;
  if (match[1] === "-" && absoluteSubatoms === 0n) {
    throw new TypeError("Signed WORK amount cannot use negative zero.");
  }
  return (
    match[1] === "-" ? -absoluteSubatoms : absoluteSubatoms
  ).toString();
}

export function tryParseSignedWorkAmountToSubatoms(value) {
  try {
    return parseSignedWorkAmountToSubatoms(value);
  } catch {
    return "";
  }
}

function formatWorkAtomsFromScale(
  value,
  unitScale,
  decimals,
  { allowNegative = false, trim = true } = {},
) {
  const atomsText = normalizeWorkAtoms(value, {
    allowNegative,
    allowZero: true,
  });
  const negative = atomsText.startsWith("-");
  const absolute = BigInt(negative ? atomsText.slice(1) : atomsText);
  const whole = absolute / unitScale;
  const fraction = String(absolute % unitScale).padStart(
    decimals,
    "0",
  );
  const displayedFraction = trim ? fraction.replace(/0+$/u, "") : fraction;
  const amount = displayedFraction
    ? `${whole}.${displayedFraction}`
    : whole.toString();
  return negative && absolute !== 0n ? `-${amount}` : amount;
}

export function formatWorkAtoms(
  value,
  { allowNegative = false, trim = true } = {},
) {
  return formatWorkAtomsFromScale(value, WORK_UNIT_SCALE, WORK_DECIMALS, {
    allowNegative,
    trim,
  });
}

export function formatWorkAtomsAmo(
  value,
  { allowNegative = false, trim = true } = {},
) {
  return formatWorkAtomsFromScale(value, WORK_AMO_UNIT_SCALE, WORK_AMO_DECIMALS, {
    allowNegative,
    trim,
  });
}

export function formatWorkSubatoms(
  value,
  { allowNegative = false, trim = true } = {},
) {
  return formatWorkAtomsFromScale(
    value,
    WORK_SUBATOM_UNIT_SCALE,
    WORK_SUBATOM_DECIMALS,
    {
      allowNegative,
      trim,
    },
  );
}

export function workPrecisionMetadata(
  model,
  { allowLegacy = true, allowSubatoms = true } = {},
) {
  const normalized = String(model ?? "").trim();
  if (
    allowLegacy &&
    normalized === WORK_LEGACY_ATOMIC_PROJECTION_MODEL
  ) {
    return Object.freeze({
      amountStorageModel: WORK_LEGACY_ATOMIC_PROJECTION_MODEL,
      decimals: WORK_LEGACY_DECIMALS,
      unitScale: WORK_LEGACY_UNIT_SCALE_TEXT,
    });
  }
  if (
    allowSubatoms &&
    normalized === WORK_SUBATOM_PROJECTION_MODEL
  ) {
    return Object.freeze({
      amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL,
      decimals: WORK_SUBATOM_DECIMALS,
      unitScale: WORK_SUBATOM_UNIT_SCALE_TEXT,
    });
  }
  return null;
}

export function validateWorkPrecisionMetadata(
  metadata,
  options = {},
) {
  const item =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? metadata
      : {};
  const expected = workPrecisionMetadata(
    item.amountStorageModel,
    options,
  );
  return Boolean(
    expected &&
      typeof item.decimals === "number" &&
      item.decimals === expected.decimals &&
      String(item.unitScale ?? "") === expected.unitScale,
  );
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

export function workAmountSubatomsFromRecord(
  record,
  {
    allowLegacy = true,
    allowZero = false,
    sourceModel = "",
    storedAmountIsSubatoms = false,
  } = {},
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
  const subatomAliases = [
    item.amountSubatoms,
    item.tokenAmountSubatoms,
    saleAuthorization.amountSubatoms,
  ].filter(
    (candidate) =>
      candidate !== undefined && candidate !== null && candidate !== "",
  );
  const model = String(
    sourceModel ||
      item.amountStorageModel ||
      saleAuthorization.amountStorageModel ||
      "",
  ).trim();
  if (
    model !== WORK_SUBATOM_PROJECTION_MODEL &&
    (!allowLegacy || model !== WORK_LEGACY_ATOMIC_PROJECTION_MODEL)
  ) {
    throw new TypeError(
      "WORK precision metadata is required to project subatoms.",
    );
  }

  const atomAliases = [
    item.amountAtoms,
    item.tokenAmountAtoms,
    saleAuthorization.amountAtoms,
  ].filter(
    (candidate) =>
      candidate !== undefined && candidate !== null && candidate !== "",
  );

  if (model === WORK_SUBATOM_PROJECTION_MODEL) {
    if (atomAliases.length > 0 || subatomAliases.length !== 1) {
      throw new TypeError(
        "Native Q16 WORK requires exactly one subatom alias and no legacy atom alias.",
      );
    }
    return normalizeWorkSubatoms(subatomAliases[0], { allowZero });
  }

  const normalizedAtomAliases = atomAliases.map((alias) =>
    legacyWorkAtomsToSubatoms(alias, { allowZero })
  );
  const normalizedSubatomAliases = subatomAliases.map((alias) =>
    normalizeWorkSubatoms(alias, { allowZero })
  );
  const uniqueAtomAliases = [...new Set(normalizedAtomAliases)];
  const uniqueSubatomAliases = [...new Set(normalizedSubatomAliases)];
  if (uniqueAtomAliases.length > 1 || uniqueSubatomAliases.length > 1) {
    throw new TypeError("Legacy WORK amount aliases are ambiguous.");
  }
  if (uniqueAtomAliases.length === 1) {
    const normalized = uniqueAtomAliases[0];
    if (
      uniqueSubatomAliases.length === 1 &&
      uniqueSubatomAliases[0] !== normalized
    ) {
      throw new TypeError(
        "Legacy WORK atom and normalized subatom aliases conflict.",
      );
    }
    return normalized;
  }
  if (subatomAliases.length > 0) {
    throw new TypeError(
      "Legacy WORK subatom aliases require their exact raw atom source.",
    );
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
  if (storedAmountIsSubatoms) {
    if (model !== WORK_SUBATOM_PROJECTION_MODEL) {
      throw new TypeError(
        "Stored WORK subatoms require explicit work-subatoms-v2 metadata.",
      );
    }
    return normalizeWorkSubatoms(amount, { allowZero });
  }
  return model === WORK_SUBATOM_PROJECTION_MODEL
    ? parseWorkAmountToSubatoms(amount, { allowZero })
    : legacyWorkAtomsToSubatoms(
        parseWorkAmountToAtoms(amount, { allowZero }),
        { allowZero },
      );
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

export function workSubatomAmountFields(record, options = {}) {
  const amountSubatoms = workAmountSubatomsFromRecord(record, options);
  return withWorkSubatomPrecisionMetadata({
    amount: formatWorkSubatoms(amountSubatoms),
    amountSubatoms,
  });
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

export function withWorkSubatomPrecisionMetadata(metadata = {}) {
  const source =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? metadata
      : {};
  return {
    ...source,
    amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL,
    decimals: WORK_SUBATOM_DECIMALS,
    unitScale: WORK_SUBATOM_UNIT_SCALE_TEXT,
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

export function workSubatomsValueAtFloorQ8(amountSubatoms, floorValue) {
  const subatoms =
    typeof amountSubatoms === "bigint"
      ? amountSubatoms
      : BigInt(amountSubatoms);
  const floorValueQ8 = decimalValueToQ8(floorValue);
  if (
    subatoms < 0n ||
    floorValueQ8 === null ||
    floorValueQ8 < 0n
  ) {
    return null;
  }
  return (subatoms * floorValueQ8) / WORK_SUBATOM_UNIT_SCALE;
}
