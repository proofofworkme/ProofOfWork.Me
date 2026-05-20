export function tokenUsd(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "$0";
  }

  if (value < 0.000001) {
    return "<$0.000001";
  }

  if (value < 0.01) {
    return `$${value.toFixed(6)}`;
  }

  return value.toLocaleString(undefined, {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  });
}
