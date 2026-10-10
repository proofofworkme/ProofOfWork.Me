export const BOOST_TIP_DEFAULT_SATS = 546;
export const BOOST_TIP_WORK_TOKEN_ID = "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
export const BOOST_TIP_WORK_MAX_SUBATOMS = "210000000000000000000000";
/** Wire quantities are exact Q16 integers; decimal entry is a separate UI concern. */
export function boostTipWorkAmount(value) {
  if (typeof value !== "string" && typeof value !== "bigint") return null;
  const text = String(value);
  if (!/^[1-9]\d{0,23}$/u.test(text)) return null;
  return BigInt(text) <= BigInt(BOOST_TIP_WORK_MAX_SUBATOMS) ? text : null;
}
export function parseBoostWorkTip(payload) {
  const parts = String(payload ?? "").split(":");
  if (parts.length !== 5 || parts[0] !== "pwb1" || parts[1] !== "tip2" ||
      !/^[0-9a-f]{64}$/u.test(parts[2]) || parts[3] !== BOOST_TIP_WORK_TOKEN_ID) return null;
  const amountSubatoms = boostTipWorkAmount(parts[4]);
  return amountSubatoms === null ? null : { targetTxid: parts[2], tokenId: parts[3], amountSubatoms };
}
export function buildBoostWorkTip(targetTxid, amountSubatoms) {
  const amount = boostTipWorkAmount(amountSubatoms);
  const payload = `pwb1:tip2:${targetTxid}:${BOOST_TIP_WORK_TOKEN_ID}:${amount ?? ""}`;
  if (!parseBoostWorkTip(payload)) throw new Error("Enter a valid target and a positive exact WORK tip amount.");
  // The accepted send3 owns registry-fee and WORK movement economics once.
  // A WORK-only tip has no ordinary Mail delivery payment or Mail carrier.
  return { payload };
}
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
