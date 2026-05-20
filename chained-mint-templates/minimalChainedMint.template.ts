// Template only. Not imported by the app yet.
// This file documents the chained mint execution model from the reviewed
// minimalChainedMint.ts example. Duplicate this file per protocol and replace
// the protocol-specific constants/builders before wiring it into UI.

import * as bitcoin from "bitcoinjs-lib";

export const CHAINED_MINT_TEMPLATE_NOTES = {
  model:
    "Spend one user UTXO, create a user output for the next transaction, repeat until final tx returns change.",
  signing:
    "Wallet signs every PSBT locally. The app never handles private keys or seed phrases.",
  broadcast:
    "Route final raw tx hex through the existing app broadcaster, including Slipstream when multiple OP_RETURN outputs require it.",
};

export type SerializedBufferLike = {
  type: "Buffer";
  data: number[];
};

export type ChainedMintWallet = {
  signPsbt: (psbt: bitcoin.Psbt) => Promise<string>;
  broadcastPsbt: (finalTxHex: string) => Promise<string>;
};

export type ChainedMintProgress = (
  status: string,
  progress: number,
) => void;

export type ChainedMintInitialUtxo = {
  txid: string;
  vout: number;
  satoshi: number;
  address: string;
};

export class ChainedMintTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChainedMintTemplateError";
  }
}

export function normalizeTaprootInternalKey(
  pubkeyHex: string | SerializedBufferLike,
) {
  let pubkey =
    typeof pubkeyHex === "string"
      ? Buffer.from(pubkeyHex, "hex")
      : Buffer.from(pubkeyHex.data);

  if (pubkey.length === 33) {
    pubkey = pubkey.slice(1);
  } else if (pubkey.length === 65) {
    pubkey = pubkey.slice(1, 33);
  } else if (pubkey.length !== 32) {
    throw new ChainedMintTemplateError(
      `Invalid Taproot key length: ${pubkey.length} bytes.`,
    );
  }

  return pubkey;
}

export function calculateTemplateNetworkFee({
  feeRate,
  isLastMint = false,
}: {
  feeRate: number;
  isLastMint?: boolean;
}) {
  const txVbytes = isLastMint ? 180 : 150;
  return Math.ceil(feeRate * txVbytes);
}

export function calculateTemplateTotalRequired({
  mintCount,
  feeRate,
  nonFinalCost,
  finalCost,
}: {
  mintCount: number;
  feeRate: number;
  nonFinalCost: (feeRate: number) => number;
  finalCost: (feeRate: number) => number;
}) {
  if (mintCount <= 0) {
    return 0;
  }
  if (mintCount === 1) {
    return finalCost(feeRate);
  }
  return (mintCount - 1) * nonFinalCost(feeRate) + finalCost(feeRate);
}
