import type { PageMetadata } from "./seoMetadata.mjs";
export type PublishArticleSeoFacts = { txid: string; title: string; description: string; size: number; sha256: string; authorAddress: string; authorDisplay: string; publishedAt: string | null };
export type PublishArticleSeoInput = Omit<PublishArticleSeoFacts, "description" | "authorDisplay" | "publishedAt"> & { body?: string; description?: string; authorDisplay?: string; publishedAt?: string | null };
export const PUBLISH_ORIGIN: string;
export const PUBLISH_SERVER_CONTENT_ID: string;
export const PUBLISH_SERVER_METADATA_ID: string;
export function publishArticleExcerpt(body: unknown): string;
export function publishArticleSeoFacts(article: PublishArticleSeoInput): PublishArticleSeoFacts;
export function publishArticleMetadata(article: PublishArticleSeoInput): PageMetadata & { ogType: "article"; authorUrl: string; publishedAt: string | null };
