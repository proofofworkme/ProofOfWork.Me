export const WORK_DECIMALS = 16;
export const WORK_UNIT_SCALE = 10_000_000_000_000_000n;
export const WORK_UNIT_SCALE_STRING = WORK_UNIT_SCALE.toString();
export const WORK_LEGACY_DECIMALS = 8;
export const WORK_LEGACY_UNIT_SCALE = 100_000_000n;
export const WORK_LEGACY_UNIT_SCALE_STRING =
  WORK_LEGACY_UNIT_SCALE.toString();
export const WORK_LEGACY_TO_CANONICAL_FACTOR =
  WORK_UNIT_SCALE / WORK_LEGACY_UNIT_SCALE;
export const WORK_AMO_DECIMALS = WORK_DECIMALS;
export const WORK_AMO_UNIT_SCALE = WORK_UNIT_SCALE;
export const WORK_AMO_UNIT_SCALE_TEXT = WORK_AMO_UNIT_SCALE.toString();

const WORK_DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.(\d{1,16}))?$/u;
const WORK_ATOMS_PATTERN = /^(?:0|[1-9]\d*)$/u;
const WORK_SIGNED_ATOMS_PATTERN = /^-?(?:0|[1-9]\d*)$/u;
const WORK_CANONICAL_SIGNED_ATOMS_PATTERN =
  /^(?:0|[1-9]\d*|-[1-9]\d*)$/u;

function decimalText(value: unknown) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      return "";
    }
    return value
      .toFixed(WORK_DECIMALS)
      .replace(/(?:\.0+|(\.\d*?[1-9])0+)$/u, "$1");
  }
  return String(value ?? "").trim();
}

export function workAtomsFromDecimal(value: unknown): bigint | null {
  const text = decimalText(value);
  const match = WORK_DECIMAL_PATTERN.exec(text);
  if (!match) {
    return null;
  }

  const [wholeText, fractionText = ""] = text.split(".");
  const fraction = fractionText.padEnd(WORK_DECIMALS, "0");
  return BigInt(wholeText) * WORK_UNIT_SCALE + BigInt(fraction || "0");
}

export function workSignedAtomsFromDecimal(value: unknown): bigint | null {
  const text = String(value ?? "").trim();
  const negative = text.startsWith("-");
  const absolute = negative ? text.slice(1) : text;
  const atoms = workAtomsFromDecimal(absolute);
  return atoms === null ? null : negative ? -atoms : atoms;
}

export function workAtomsFromIntegerString(value: unknown): bigint | null {
  const text = String(value ?? "").trim();
  return WORK_ATOMS_PATTERN.test(text) ? BigInt(text) : null;
}

export function workSubatomsFromCanonicalString(
  value: unknown,
): bigint | null {
  const text = typeof value === "string" ? value : "";
  return WORK_ATOMS_PATTERN.test(text) ? BigInt(text) : null;
}

export function workSignedSubatomsFromCanonicalString(
  value: unknown,
): bigint | null {
  const text = typeof value === "string" ? value : "";
  return WORK_CANONICAL_SIGNED_ATOMS_PATTERN.test(text)
    ? BigInt(text)
    : null;
}

export function workSubatomsFromLegacyAtoms(value: unknown): bigint | null {
  const atoms = workAtomsFromIntegerString(value);
  return atoms === null ? null : atoms * WORK_LEGACY_TO_CANONICAL_FACTOR;
}

export function workSignedSubatomsFromLegacyAtoms(
  value: unknown,
): bigint | null {
  const atoms = workSignedAtomsFromIntegerString(value);
  return atoms === null ? null : atoms * WORK_LEGACY_TO_CANONICAL_FACTOR;
}

export function workLegacyAtomsFromSubatoms(value: unknown): bigint | null {
  const subatoms = workAtomsFromIntegerString(value);
  return subatoms !== null &&
    subatoms % WORK_LEGACY_TO_CANONICAL_FACTOR === 0n
    ? subatoms / WORK_LEGACY_TO_CANONICAL_FACTOR
    : null;
}

export function workSignedAtomsFromIntegerString(value: unknown): bigint | null {
  const text = String(value ?? "").trim();
  return WORK_SIGNED_ATOMS_PATTERN.test(text) ? BigInt(text) : null;
}

export function workDecimalFromAtoms(value: bigint | string) {
  const atoms =
    typeof value === "bigint"
      ? value
      : workSignedAtomsFromIntegerString(value);
  if (atoms === null) {
    return "0";
  }

  const negative = atoms < 0n;
  const absoluteAtoms = negative ? -atoms : atoms;
  const whole = absoluteAtoms / WORK_UNIT_SCALE;
  const fraction = (absoluteAtoms % WORK_UNIT_SCALE)
    .toString()
    .padStart(WORK_DECIMALS, "0")
    .replace(/0+$/u, "");
  const canonical = fraction ? `${whole}.${fraction}` : whole.toString();
  return negative ? `-${canonical}` : canonical;
}

export function legacyWorkDecimalFromAtoms(value: bigint | string) {
  return formatWorkAmountWithScale(
    value,
    WORK_LEGACY_DECIMALS,
    WORK_LEGACY_UNIT_SCALE,
  );
}

function formatWorkAmountWithScale(
  value: bigint | string,
  fractionDigits: number,
  scale: bigint,
  trimTrailingZeros = true,
) {
  const atoms =
    typeof value === "bigint"
      ? value
      : workSignedAtomsFromIntegerString(value);
  if (atoms === null) {
    return "0";
  }

  if (!Number.isInteger(fractionDigits) || fractionDigits < 0) {
    return workDecimalFromAtoms(atoms);
  }

  const negative = atoms < 0n;
  const absoluteAtoms = negative ? -atoms : atoms;
  const whole = absoluteAtoms / scale;
  const fraction = (absoluteAtoms % scale)
    .toString()
    .padStart(fractionDigits, "0");
  const canonical =
    fractionDigits === 0
      ? ""
      : trimTrailingZeros
        ? fraction.slice(0, fractionDigits).replace(/0+$/u, "")
        : fraction.slice(0, fractionDigits);
  const formatted = canonical ? `${whole.toString()}.${canonical}` : whole.toString();
  return negative ? `-${formatted}` : formatted;
}

export function workAtomsFromRecord(
  amountAtoms: unknown,
  legacyWholeAmount: unknown,
  amountSubatoms?: unknown,
) {
  const hasExplicitSubatoms =
    amountSubatoms !== undefined &&
    amountSubatoms !== null &&
    String(amountSubatoms) !== "";
  const explicitAtomsText = String(amountAtoms ?? "").trim();
  if (hasExplicitSubatoms && explicitAtomsText) {
    const subatoms = workSubatomsFromCanonicalString(amountSubatoms);
    const normalizedLegacyAtoms =
      workSubatomsFromLegacyAtoms(explicitAtomsText);
    return subatoms !== null && subatoms === normalizedLegacyAtoms
      ? subatoms
      : null;
  }
  if (hasExplicitSubatoms) {
    return workSubatomsFromCanonicalString(amountSubatoms);
  }
  if (explicitAtomsText) {
    return workSubatomsFromLegacyAtoms(explicitAtomsText);
  }

  const legacyText = decimalText(legacyWholeAmount);
  return legacyText ? workAtomsFromDecimal(legacyText) : null;
}

export function workNumberFromAtoms(value: bigint | string) {
  return Number(workDecimalFromAtoms(value));
}

export function formatWorkAmount(
  value: bigint | string,
  trimTrailingZeros = false,
) {
  const canonical = formatWorkAmountWithScale(
    value,
    WORK_DECIMALS,
    WORK_UNIT_SCALE,
    trimTrailingZeros,
  );
  const [whole, fraction] = canonical.split(".");
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  return fraction ? `${groupedWhole}.${fraction}` : groupedWhole;
}

export function formatWorkAmountAmo(
  value: bigint | string,
  trimTrailingZeros = true,
) {
  const canonical = formatWorkAmountWithScale(
    value,
    WORK_AMO_DECIMALS,
    WORK_AMO_UNIT_SCALE,
    trimTrailingZeros,
  );
  const [whole, fraction] = canonical.split(".");
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  return fraction ? `${groupedWhole}.${fraction}` : groupedWhole;
}

export function formatLegacyWorkAmount(value: bigint | string) {
  const canonical = formatWorkAmountWithScale(
    value,
    WORK_LEGACY_DECIMALS,
    WORK_LEGACY_UNIT_SCALE,
  );
  const [whole, fraction] = canonical.split(".");
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  return fraction ? `${groupedWhole}.${fraction}` : groupedWhole;
}

export function canonicalWorkDecimal(value: unknown) {
  const atoms = workAtomsFromDecimal(value);
  return atoms === null ? "" : workDecimalFromAtoms(atoms);
}

export function positiveWorkAtoms(value: unknown) {
  const atoms = workAtomsFromDecimal(value);
  return atoms !== null && atoms > 0n ? atoms : null;
}
