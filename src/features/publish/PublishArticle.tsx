import { ArrowUpRight, BookOpen } from "lucide-react";
import { useLayoutEffect } from "react";
import { failServerArticleRead, finishServerArticleRead, useVerifiedDocumentMetadata } from "../../app/documentMetadata";
import { publishArticleMetadata, publishArticleSeoFacts } from "../../app/publishArticleSeo.mjs";
import { formatDate } from "../../functions";
import { explorerTxUrl, type BitcoinNetwork } from "../../shared/bitcoin/networks";
import { PUBLISH_ARTICLE_VERIFICATION, normalizePublishArticleMetadata, publishArticleBodyBytes } from "../../shared/protocol/publishArticle.mjs";
import { sha256Hex } from "../../shared/utils/encoding";
import type { BoostFeedItem } from "../boost/boostProtocol";
import { BoostText } from "../boost/BoostText";
import { YouTubeLinkCards } from "../../shared/media/YouTubeLinkCards";
import { publishHref } from "./publishProtocol";

export function PublishArticleCard({ item, network, embedded = false }: { item: BoostFeedItem; network: BitcoinNetwork; embedded?: boolean }) {
  const article = normalizePublishArticleMetadata(item.article);
  if (!article || item.articleVerification !== PUBLISH_ARTICLE_VERIFICATION || !item.confirmed) return null;
  return <a className="publish-article-card" href={publishHref({ txid: item.txid, network, embedded })}>
    <span className="publish-card-label"><BookOpen size={14} /> Article · Confirmed</span>
    <h2>{article.title}</h2>
    <p>{article.size.toLocaleString()} bytes · Published {formatDate(item.createdAt)}</p>
    <span className="publish-read-link">Read article <ArrowUpRight size={14} /></span>
  </a>;
}

export function PublishArticleText({ item, network, onVerified }: { item: BoostFeedItem; network: BitcoinNetwork; onVerified?: (verified: boolean) => void }) {
  const article = normalizePublishArticleMetadata(item.article);
  const bytes = publishArticleBodyBytes(item.articleBody);
  const verified = article && item.confirmed && item.articleVerification === PUBLISH_ARTICLE_VERIFICATION &&
    bytes && bytes.length === article.size && sha256Hex(bytes) === article.sha256;
  const facts = verified ? publishArticleSeoFacts({ ...article, txid: item.txid, body: item.articleBody!,
    authorAddress: item.authorAddress, authorDisplay: item.authorDisplay || item.authorAddress,
    // The API's createdAt may be an indexing fallback; it is not publication evidence.
    publishedAt: null }) : undefined;
  const seo = facts ? publishArticleMetadata(facts) : undefined;
  useVerifiedDocumentMetadata({ parameter: "article", id: item.txid, network,
    metadata: seo ? { title: seo.title, description: seo.description, article: facts } : undefined });
  useLayoutEffect(() => {
    if (verified) finishServerArticleRead();
    else failServerArticleRead();
    onVerified?.(Boolean(verified));
    return () => onVerified?.(false);
  }, [onVerified, verified]);
  if (!verified) return <div className="publish-read-error" role="alert"><h2>Article text unavailable</h2>
    <p>This transaction has not supplied a confirmed article whose exact text matches its published size and SHA-256.</p>
    <a href={explorerTxUrl(item.txid, network)} target="_blank" rel="noreferrer">Inspect transaction</a>
  </div>;
  const words = item.articleBody!.trim().split(/\s+/u).length;
  return <div className="publish-reading"><h1>{article.title}</h1>
    <p className="publish-byline">By <a rel="author" href={seo!.authorUrl}>{facts!.authorDisplay}</a> · {Math.max(1, Math.ceil(words / 220))} min read · Confirmed</p>
    <div className="publish-article-body"><BoostText text={item.articleBody!} dnsOnly network={network} /></div>
    <YouTubeLinkCards text={item.articleBody!} />
    <details className="publish-reader-proof"><summary>Exact article evidence</summary>
      <p>{article.size.toLocaleString()} UTF-8 bytes · Verified SHA-256</p><code>{article.sha256}</code>
      <code>{item.txid}</code><p><a href={explorerTxUrl(item.txid, network)} target="_blank" rel="noreferrer">View transaction</a></p>
    </details>
  </div>;
}
