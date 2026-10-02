export type BoostTextSegment = {
  kind: "text" | "cashtag" | "hashtag" | "mention";
  text: string;
  value: string;
  identityKind?: "id" | "address";
};

export function parseBoostText(text: unknown): BoostTextSegment[];
export function boostTextMatchesTag(text: unknown, query: unknown): boolean;
