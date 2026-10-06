export const BOOST_TIP_DEFAULT_SATS: number;
export function boostTipAmount(value: unknown): number | null;
export function parseBoostTip(payload: unknown): { targetTxid: string; amountSats: number } | null;
export function buildBoostTip(targetTxid: string, amount: unknown): { payload: string; mailPayload: string };
