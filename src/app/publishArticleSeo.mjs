import { resolvePageMetadata } from "./seoMetadata.mjs";

export const PUBLISH_ORIGIN = "https://publish.proofofwork.me";
export const PUBLISH_SERVER_CONTENT_ID = "publish-server-content";
export const PUBLISH_SERVER_METADATA_ID = "publish-server-metadata";

export function publishArticleExcerpt(body) {
  const characters = Array.from(String(body ?? "").replace(/\s+/gu, " ").trim());
  return characters.length > 160 ? `${characters.slice(0, 159).join("").trimEnd()}…` : characters.join("");
}

/** Presentation facts only. Callers must first verify the canonical article bytes. */
export function publishArticleSeoFacts(article) {
  if (!article || !/^[a-f0-9]{64}$/iu.test(article.txid ?? "") ||
      typeof article.title !== "string" || !article.title.trim() || article.title.length > 140 ||
      !Number.isSafeInteger(article.size) || article.size < 1 || article.size > 100_000 ||
      !/^[a-f0-9]{64}$/u.test(article.sha256 ?? "") ||
      typeof article.authorAddress !== "string" || !article.authorAddress || article.authorAddress.length > 128) {
    throw new TypeError("Invalid verified article presentation facts.");
  }
  const publishedAt = typeof article.publishedAt === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(article.publishedAt) &&
    Number.isFinite(Date.parse(article.publishedAt)) ? new Date(article.publishedAt).toISOString() : null;
  return {
    txid: article.txid.toLowerCase(), title: article.title,
    description: publishArticleExcerpt(typeof article.body === "string" ? article.body : article.description),
    size: article.size, sha256: article.sha256, authorAddress: article.authorAddress,
    authorDisplay: typeof article.authorDisplay === "string" && article.authorDisplay.trim() && article.authorDisplay.length <= 512
      ? article.authorDisplay : article.authorAddress,
    publishedAt,
  };
}

export function publishArticleMetadata(article) {
  const facts = publishArticleSeoFacts(article);
  const canonicalUrl = `${PUBLISH_ORIGIN}/?article=${facts.txid}`;
  const authorUrl = `${PUBLISH_ORIGIN}/?profile=${encodeURIComponent(facts.authorAddress)}`;
  const metadata = resolvePageMetadata("publish", canonicalUrl, {
    title: `${facts.title} | ProofOfWork Publish`, description: facts.description,
  });
  // An all-whitespace body is still exact source text; do not invent an excerpt.
  metadata.description = facts.description;
  return { ...metadata, ogType: "article", authorUrl, publishedAt: facts.publishedAt,
    structuredData: [{ "@context": "https://schema.org", "@type": "Article",
      headline: facts.title, url: canonicalUrl, mainEntityOfPage: canonicalUrl,
      ...(facts.description ? { description: facts.description } : {}),
      author: { "@type": "Person", name: facts.authorDisplay, identifier: facts.authorAddress, url: authorUrl },
      ...(facts.publishedAt ? { datePublished: facts.publishedAt } : {}),
    }],
  };
}
