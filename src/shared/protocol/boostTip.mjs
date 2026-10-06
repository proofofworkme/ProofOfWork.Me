export const BOOST_TIP_DEFAULT_SATS = 546;
export function boostTipAmount(value) {
  const text = String(value ?? "");
  if (text.length > 16 || !/^[1-9]\d*$/u.test(text)) return null;
  const amount = BigInt(text);
  return amount <= 2_100_000_000_000_000n ? Number(amount) : null;
}
export function parseBoostTip(payload) {
  const parts = String(payload ?? "").split(":");
  if (parts.length !== 4 || parts[0] !== "pwb1" || parts[1] !== "tip" ||
      !/^[0-9a-f]{64}$/u.test(parts[2])) return null;
  const amountSats = boostTipAmount(parts[3]);
  return amountSats === null ? null : { targetTxid: parts[2], amountSats };
}
export function buildBoostTip(targetTxid, amount) {
  const payload = `pwb1:tip:${targetTxid}:${amount}`;
  const tip = parseBoostTip(payload);
  if (!tip) throw new Error("Enter a valid target and a positive whole-proof tip amount.");
  // One payment, two records. Existing Mail economics owns the payment once;
  // the Boost record supplies its content association, never a second delta.
  return { payload, mailPayload: `pwm1:m:Tip ${tip.amountSats} proofs for ProofOfWork content ${tip.targetTxid}` };
}
