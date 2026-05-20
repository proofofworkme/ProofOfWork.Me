export function satsToUsd(sats: number, btcUsd: number) {
  return (sats / 100_000_000) * btcUsd;
}
