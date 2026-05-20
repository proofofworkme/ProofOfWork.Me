export function tokenSatsPerUnit(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }

  if (Number.isInteger(value)) {
    return value.toLocaleString();
  }

  return value.toLocaleString(undefined, {
    maximumFractionDigits: 8,
  });
}
