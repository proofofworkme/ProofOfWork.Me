// A linked upload is an existing Files action, but the article workflow must
// not start spending fees until the current application explicitly admits v2.
export function assertLinkedPublishCapability(value, network, now = Date.now()) {
  const time = typeof value?.serverTime === "string" ? Date.parse(value.serverTime) : NaN;
  if (!Number.isFinite(now) || !Number.isFinite(time) || now - time > 60_000 || time - now > 10_000 || network !== "livenet" || !value || value.model !== "publish-linked-capability-v2" ||
      value.network !== network || value.enabled !== true || value.readerVersion !== 2 || value.indexerVersion !== 2 ||
      !Number.isSafeInteger(value.checkpoint?.height) || value.checkpoint.height < 1 ||
      typeof value.checkpoint?.hash !== "string" || !/^[0-9a-f]{64}$/u.test(value.checkpoint.hash)) {
    throw new Error("Linked article publishing is not ready on the current node and indexer. Your draft is preserved; try again after the release is verified.");
  }
  return {height:value.checkpoint.height,hash:value.checkpoint.hash};
}
