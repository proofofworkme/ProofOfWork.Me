export const WORK_DECIMALS = 8;
export const WORK_UNIT_SCALE = 100_000_000n;
export const WORK_UNIT_SCALE_STRING = WORK_UNIT_SCALE.toString();

const WORK_DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.(\d{1,8}))?$/u;
const WORK_ATOMS_PATTERN = /^(?:0|[1-9]\d*)$/u;
const WORK_SIGNED_ATOMS_PATTERN = /^-?(?:0|[1-9]\d*)$/u;

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

export function workAtomsFromIntegerString(value: unknown): bigint | null {
  const text = String(value ?? "").trim();
  return WORK_ATOMS_PATTERN.test(text) ? BigInt(text) : null;
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

export function workAtomsFromRecord(
  amountAtoms: unknown,
  legacyWholeAmount: unknown,
) {
  const explicitAtomsText = String(amountAtoms ?? "").trim();
  if (explicitAtomsText) {
    return workAtomsFromIntegerString(explicitAtomsText);
  }

  const legacyText = decimalText(legacyWholeAmount);
  if (!WORK_ATOMS_PATTERN.test(legacyText)) {
    return null;
  }
  return BigInt(legacyText) * WORK_UNIT_SCALE;
}

export function workNumberFromAtoms(value: bigint | string) {
  return Number(workDecimalFromAtoms(value));
}

export function formatWorkAmount(value: bigint | string) {
  const canonical = workDecimalFromAtoms(value);
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
