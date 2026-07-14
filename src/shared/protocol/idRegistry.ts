import type { BitcoinNetwork } from "../bitcoin/networks";

const ID_REGISTRY_ADDRESSES: Partial<Record<BitcoinNetwork, string>> = {
  livenet: "bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e",
};

export function registryAddressForNetwork(network: BitcoinNetwork) {
  return ID_REGISTRY_ADDRESSES[network] ?? "";
}
