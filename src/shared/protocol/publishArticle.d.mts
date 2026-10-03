export type PublishArticleMetadata = {
  v: 1;
  title: string;
  source: "same-tx-pwm1-message";
  size: number;
  sha256: string;
};
export const PUBLISH_ARTICLE_SOURCE: "same-tx-pwm1-message";
export const PUBLISH_ARTICLE_VERIFICATION: "canonical-same-tx-pwm1-message-v1";
export const PUBLISH_DATA_CARRIER_LIMIT: 100000;
export function publishArticleBodyBytes(body: unknown): Uint8Array | null;
export function normalizePublishArticleMetadata(value: unknown): PublishArticleMetadata | null;
export function publishArticleMetadataFromPayload(payload: unknown): PublishArticleMetadata | null;
export function publishArticleBodyFromRecords(records: unknown, metadata: unknown, sha256: (bytes: Uint8Array) => string): string | null;
export function publishArticleDataCarrierBytes(transaction: unknown): number | null;
