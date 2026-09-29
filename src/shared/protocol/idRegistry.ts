import type { BitcoinNetwork } from "../bitcoin/networks";

const ID_REGISTRY_ADDRESSES: Partial<Record<BitcoinNetwork, string>> = {
  livenet: "bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e",
};

const DNS_REGISTRY_ADDRESSES: Partial<Record<BitcoinNetwork, string>> = {
  livenet: "1F1zepCJ8VPcPoeMt6G4BPKuE3CYAxCKNY",
};

export function registryAddressForNetwork(network: BitcoinNetwork) {
  return ID_REGISTRY_ADDRESSES[network] ?? "";
}

export function dnsRegistryAddressForNetwork(network: BitcoinNetwork) {
  return DNS_REGISTRY_ADDRESSES[network] ?? "";
}
