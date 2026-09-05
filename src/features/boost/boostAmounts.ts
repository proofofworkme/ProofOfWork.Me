import { exactIntegerBigInt, formatExactQ8 } from "../../exactAmount";

const SCALE = 100_000_000n;

export function boostSignalQ8(q8: unknown, exact: unknown, legacy: unknown = 0): bigint {
  const canonical = exactIntegerBigInt(q8);
  if (canonical !== null) {
    if (exact !== undefined && exact !== null && boostSignalQ8(undefined, exact) !== canonical) {
      throw new Error("Boost exact amount fields disagree.");
    }
    return canonical;
  }
  if (q8 !== undefined && q8 !== null) throw new Error("Boost signal has an invalid exact Q8 amount.");
  const value = exact ?? legacy;
  if (typeof value === "number") {
    if (Number.isSafeInteger(value) && value >= 0) return BigInt(value) * SCALE;
    throw new Error("Boost signal is missing its exact value. Refresh to load canonical amounts.");
  }
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/u.test(value)) {
    throw new Error("Boost signal has an invalid exact amount.");
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(8, "0"));
}

export function formatBoostSignal(q8: bigint) {
  return `${formatExactQ8(q8)} proofs`;
}
