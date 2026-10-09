import type { BitcoinNetwork } from "../bitcoin/networks";

export type WalletConnectionStage = "accounts" | "network" | "switch" | "verify";
export type WalletConnectionProvider = {
  requestAccounts?: () => Promise<string[]>;
  getAccounts?: () => Promise<string[]>;
  getChain?: () => Promise<{ enum?: string; network?: string }>;
  getNetwork?: () => Promise<string>;
  switchChain?: (chain: "BITCOIN_MAINNET" | "BITCOIN_TESTNET" | "BITCOIN_TESTNET4") => Promise<unknown>;
  switchNetwork?: (network: "livenet" | "testnet") => Promise<unknown>;
};
export class WalletConnectionError extends Error {
  code: string;
  stage?: WalletConnectionStage;
  constructor(code: string, message: string, stage?: WalletConnectionStage);
}
export type WalletConnectionOptions = {
  authorize?: boolean;
  requiredNetwork?: BitcoinNetwork;
  onStage?: (state: { stage: WalletConnectionStage; message: string }) => void;
  isCurrent?: () => boolean;
  sameAddress?: (left: string, right: string) => boolean;
};
export type WalletConnectionController = {
  readonly isConnecting: boolean;
  connect(wallet: WalletConnectionProvider, options?: WalletConnectionOptions): Promise<{ address: string; network: BitcoinNetwork }>;
  invalidate(): void;
};
export function createWalletConnectionController(options?: {
  authorizationTimeoutMs?: number;
  stageTimeoutMs?: number;
  switchTimeoutMs?: number;
}): WalletConnectionController;
