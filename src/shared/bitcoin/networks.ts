export type BitcoinNetwork = "livenet" | "testnet" | "testnet4";

export function mempoolBase(network: BitcoinNetwork) {
  if (network === "testnet4") {
    return "https://mempool.space/testnet4";
  }

  if (network === "testnet") {
    return "https://mempool.space/testnet";
  }

  return "https://mempool.space";
}

export function mempoolTxUrl(txid: string, network: BitcoinNetwork) {
  return `${mempoolBase(network)}/tx/${txid}`;
}
