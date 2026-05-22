export type BitcoinNetwork = "livenet" | "testnet" | "testnet4";

export function explorerBase(network: BitcoinNetwork) {
  if (network === "testnet4") {
    return "https://mempool.space/testnet4";
  }

  if (network === "testnet") {
    return "https://mempool.space/testnet";
  }

  return "https://mempool.space";
}

export function explorerTxUrl(txid: string, network: BitcoinNetwork) {
  return `${explorerBase(network)}/tx/${txid}`;
}

export function explorerAddressUrl(address: string, network: BitcoinNetwork) {
  return `${explorerBase(network)}/address/${address}`;
}
