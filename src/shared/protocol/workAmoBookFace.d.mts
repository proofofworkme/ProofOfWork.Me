import { WORK_AMO_FACE_PROOFS } from "./workAmoExpandedLiquidity.mjs";

export type WorkBookFace = typeof WORK_AMO_FACE_PROOFS[number];
export function workAmoBookFace(listing: unknown): WorkBookFace | undefined;
export function workAmoBookLookupId(query: string): string | undefined;
