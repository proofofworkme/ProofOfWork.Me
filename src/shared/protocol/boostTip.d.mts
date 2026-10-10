export const BOOST_TIP_DEFAULT_SATS: number;
export function boostTipAmount(value: unknown): number | null;
export function parseBoostTip(payload: unknown): { targetTxid: string; amountSats: number } | null;
export function buildBoostTip(targetTxid: string, amount: unknown): { payload: string; mailPayload: string };
export const BOOST_TIP_WORK_TOKEN_ID: string;
export const BOOST_TIP_WORK_MAX_SUBATOMS: string;
export function boostTipWorkAmount(value: unknown): string | null;
export function parseBoostWorkTip(payload: unknown): { targetTxid: string; tokenId: string; amountSubatoms: string } | null;
export function buildBoostWorkTip(targetTxid: string, amountSubatoms: string | bigint): { payload: string };
