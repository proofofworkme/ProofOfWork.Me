import { WORK_AMO_FACE_PROOFS } from "./workAmoExpandedLiquidity.mjs";

// Book membership follows the signed face. Never infer it from a price,
// current estimate, or the absence of an expanded-tier field on old tickets.
export function workAmoBookFace(listing) {
  const authorization = listing?.saleAuthorization;
  const face = authorization?.unitFaceProofs;
  const matchesFace = (terms) => terms?.version === "pwt-sale-v8" && terms.unitFaceProofs === face;
  if (!WORK_AMO_FACE_PROOFS.includes(face) || !matchesFace(authorization) ||
      (listing.unitFaceProofs !== undefined && listing.unitFaceProofs !== face) ||
      (listing.listingAuthorization != null && !matchesFace(listing.listingAuthorization))) return undefined;
  // The V8 relational reader and historical replay expose these flat frozen-term
  // records under several keys. Display-v2 preserves all of them.
  const candidates = [listing.frozenTerms, listing.workAmoFrozenTerms, listing.workAmoV8FrozenTerms,
    listing.listingFrozenTerms, listing.workAmoV6FrozenTerms, listing.workAmoPricing?.frozenTerms,
    listing.workMarketPricing?.frozenTerms].filter((terms) => terms != null);
  const first = candidates[0];
  for (const terms of candidates) {
    if (!matchesFace(terms) || (terms !== first && (Object.keys(terms).length !== Object.keys(first).length ||
        Object.keys(first).some((field) => terms[field] !== first[field])))) return undefined;
  }
  return face;
}

export function workAmoBookLookupId(query) {
  const id = query.trim().toLowerCase();
  return /^[0-9a-f]{64}$/u.test(id) ? id : undefined;
}
