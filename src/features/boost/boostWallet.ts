import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "@bitcoinerlab/secp256k1";
import { Buffer } from "buffer";
import {
  enrichWalletCuratedUtxoConfirmations,
  normalizeWalletUtxos,
  selectUtxos,
  type WalletUtxo,
} from "../../walletUtxos";
import { errorMessage, shortAddress } from "../../functions";
import {
  explorerTxUrl,
  type BitcoinNetwork,
} from "../../shared/bitcoin/networks";
import { fetchProofApiJson, proofApiUrl } from "../../shared/api/proofApiClient";
import { MAX_DATA_CARRIER_BYTES } from "../../shared/bitcoin/protocolLimits";

bitcoin.initEccLib(ecc);

export type UniSatChain =
  | "BITCOIN_MAINNET"
  | "BITCOIN_TESTNET"
  | "BITCOIN_TESTNET4";

export type LegacyBitcoinNetwork = "livenet" | "testnet";

export type UniSatEvent = "accountsChanged" | "networkChanged" | "chainChanged";

export type UnisatWallet = {
  getAccounts?: () => Promise<string[]>;
  getBitcoinUtxos?: () => Promise<Array<Record<string, unknown>>>;
  getChain?: () => Promise<{ enum?: string; network?: string }>;
  getNetwork?: () => Promise<string>;
  getPublicKey?: () => Promise<string>;
  getUtxos?: () => Promise<Array<Record<string, unknown>>>;
  on?: (event: UniSatEvent, listener: (...args: unknown[]) => void) => void;
  pushPsbt?: (psbtHex: string) => Promise<string>;
  removeListener?: (
    event: UniSatEvent,
    listener: (...args: unknown[]) => void,
  ) => void;
  requestAccounts?: () => Promise<string[]>;
  signMessage?: (message: string, type?: string) => Promise<string>;
  signPsbt?: (
    psbtHex: string,
    options?: {
      autoFinalized?: boolean;
      toSignInputs?: Array<{
        address?: string;
        disableTweakSigner?: boolean;
        index: number;
        publicKey?: string;
        sighashTypes?: number[];
        useTweakedSigner?: boolean;
      }>;
    },
  ) => Promise<string>;
  switchChain?: (
    chain: UniSatChain,
  ) => Promise<{ enum?: string; network?: string }>;
  switchNetwork?: (network: LegacyBitcoinNetwork) => Promise<string>;
};

export type BoostPaymentOutput = {
  address?: string;
  amountSats: number;
  script?: Uint8Array;
};

export type BoostSpentOutpoint = {
  txid: string;
  vout: number;
};

export type BoostPaymentPsbt = {
  changeSats: number;
  dustFeeSats: number;
  feeSats: number;
  inputCount: number;
  outputCount: number;
  psbtHex: string;
  walletInputIndexes: number[];
};

export type BoostTransactionBroadcastResult = {
  opReturnCount: number;
  source: "node" | "wallet";
  txid: string;
  url: string;
};

const DUST_SATS = 546;
const UTXO_FETCH_RETRY_DELAYS_MS = [0, 1_500, 3_000];
const UTXO_FETCH_TIMEOUT_MS = 30_000;
const BROADCAST_RETRY_DELAYS_MS = [900, 2_500, 5_000];

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function bitcoinNetwork(network: BitcoinNetwork) {
  return network === "livenet"
    ? bitcoin.networks.bitcoin
    : bitcoin.networks.testnet;
}

function chainForNetwork(network: BitcoinNetwork): UniSatChain {
  if (network === "testnet4") {
    return "BITCOIN_TESTNET4";
  }
  return network === "livenet" ? "BITCOIN_MAINNET" : "BITCOIN_TESTNET";
}

export function networkLabel(network: BitcoinNetwork) {
  if (network === "testnet4") {
    return "Testnet4";
  }
  return network === "livenet" ? "Mainnet" : "Testnet3";
}

export function isValidBitcoinAddress(
  address: string,
  network: BitcoinNetwork,
) {
  try {
    bitcoin.address.toOutputScript(address, bitcoinNetwork(network));
    return true;
  } catch {
    return false;
  }
}

export function scriptForAddress(
  address: string,
  network: BitcoinNetwork,
  fieldName: string,
) {
  try {
    return bitcoin.address.toOutputScript(address, bitcoinNetwork(network));
  } catch {
    throw new Error(
      `${fieldName} is not a valid ${networkLabel(network)} address.`,
    );
  }
}

function varIntSize(value: number) {
  if (value < 0xfd) return 1;
  if (value <= 0xffff) return 3;
  if (value <= 0xffffffff) return 5;
  return 9;
}

function outputVbytesForScript(script: Uint8Array) {
  return 8 + varIntSize(script.length) + script.length;
}

export function opReturnScriptForPayload(payload: string) {
  const output = bitcoin.payments.embed({
    data: [Buffer.from(payload, "utf8")],
  }).output;
  if (!output) {
    throw new Error("Could not build OP_RETURN output.");
  }
  if (output.length > MAX_DATA_CARRIER_BYTES) {
    throw new Error("One OP_RETURN data-carrier output is over 100 KB.");
  }
  return output;
}

export function dataCarrierBytesForPayload(payload: string) {
  return opReturnScriptForPayload(payload).length;
}

export async function getWalletNetwork(
  wallet: UnisatWallet,
): Promise<BitcoinNetwork | undefined> {
  const chain = await wallet.getChain?.().catch(() => undefined);
  if (chain?.enum === "BITCOIN_MAINNET") {
    return "livenet";
  }
  if (chain?.enum === "BITCOIN_TESTNET") {
    return "testnet";
  }
  if (chain?.enum === "BITCOIN_TESTNET4") {
    return "testnet4";
  }
  const walletNetwork = await wallet.getNetwork?.().catch(() => undefined);
  return walletNetwork === "livenet" || walletNetwork === "testnet"
    ? walletNetwork
    : undefined;
}

async function switchWalletNetwork(
  wallet: UnisatWallet,
  network: BitcoinNetwork,
) {
  if (wallet.switchChain) {
    await wallet.switchChain(chainForNetwork(network));
    return;
  }
  if (wallet.switchNetwork) {
    if (network === "testnet4") {
      throw new Error(
        "This UniSat version cannot switch to testnet4 through switchNetwork.",
      );
    }
    await wallet.switchNetwork(network);
  }
}

export async function ensureWalletNetwork(
  wallet: UnisatWallet,
  expectedNetwork: BitcoinNetwork,
  expectedAddress = "",
) {
  const currentNetwork = await getWalletNetwork(wallet);
  if (currentNetwork !== expectedNetwork) {
    await switchWalletNetwork(wallet, expectedNetwork);
  }
  const verifiedNetwork = await getWalletNetwork(wallet);
  if (verifiedNetwork !== expectedNetwork) {
    throw new Error(
      `UniSat did not switch to ${networkLabel(expectedNetwork)}. No transaction was created.`,
    );
  }
  const [verifiedAddress = ""] =
    (await wallet.getAccounts?.().catch(() => [])) ?? [];
  if (
    expectedAddress &&
    verifiedAddress &&
    verifiedAddress.trim().toLowerCase() !== expectedAddress.trim().toLowerCase()
  ) {
    throw new Error(
      "The active UniSat account changed during the network switch. No transaction was created.",
    );
  }
  return verifiedAddress || expectedAddress;
}

export async function assertActiveWalletAddress(
  wallet: UnisatWallet,
  expectedAddress: string,
) {
  if (!wallet.getAccounts) {
    return;
  }
  const [activeAddress] = await wallet.getAccounts();
  if (
    !activeAddress ||
    activeAddress.trim().toLowerCase() !== expectedAddress.trim().toLowerCase()
  ) {
    throw new Error(
      "The active UniSat account changed. No transaction was created.",
    );
  }
}

async function fetchAddressApiUtxos(
  ownerAddress: string,
  ownerNetwork: BitcoinNetwork,
): Promise<WalletUtxo[]> {
  const apiPath = `/api/v1/address/${encodeURIComponent(ownerAddress)}/utxo`;
  let lastError: unknown;
  for (const retryDelayMs of UTXO_FETCH_RETRY_DELAYS_MS) {
    if (retryDelayMs > 0) {
      await delay(retryDelayMs);
    }
    const controller = new AbortController();
    let timedOut = false;
    const timeout = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, UTXO_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(proofApiUrl(apiPath, ownerNetwork), {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const apiError =
          payload && typeof payload === "object" && "error" in payload
            ? String((payload as { error?: unknown }).error ?? "").trim()
            : "";
        throw new Error(
          apiError || `UTXO lookup returned HTTP ${response.status}.`,
        );
      }
      const payload = await response.json();
      return normalizeWalletUtxos(
        Array.isArray(payload) ? payload : [],
        "api",
      );
    } catch (error) {
      lastError =
        timedOut ||
        (error instanceof DOMException && error.name === "AbortError")
          ? new Error("Wallet UTXO lookup timed out.")
          : error;
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }
  throw new Error(errorMessage(lastError, "Could not load wallet UTXOs."));
}

async function fetchUtxos(
  ownerAddress: string,
  ownerNetwork: BitcoinNetwork,
): Promise<WalletUtxo[]> {
  const walletUtxoReader =
    window.unisat?.getBitcoinUtxos ?? window.unisat?.getUtxos;
  const walletUtxoSource = window.unisat?.getBitcoinUtxos
    ? "wallet-curated"
    : "wallet-generic";
  if (walletUtxoReader && ownerNetwork === "livenet") {
    try {
      const rawWalletUtxos = await walletUtxoReader.call(window.unisat);
      if (Array.isArray(rawWalletUtxos)) {
        const walletUtxos = normalizeWalletUtxos(
          rawWalletUtxos,
          walletUtxoSource,
        );
        if (
          walletUtxoSource === "wallet-curated" &&
          walletUtxos.some((utxo) => typeof utxo.status?.confirmed !== "boolean")
        ) {
          const statusEvidence = await fetchAddressApiUtxos(
            ownerAddress,
            ownerNetwork,
          );
          return walletUtxos.length > 0
            ? enrichWalletCuratedUtxoConfirmations(walletUtxos, statusEvidence)
            : statusEvidence;
        }
        if (walletUtxos.some((utxo) => utxo.status?.confirmed)) {
          return walletUtxos;
        }
      } else if (walletUtxoSource === "wallet-curated") {
        throw new Error("UniSat returned an invalid curated UTXO response.");
      }
    } catch (error) {
      if (walletUtxoSource === "wallet-curated") {
        throw new Error(
          `${errorMessage(error, "UniSat could not provide curated UTXOs.")} No raw address outputs were selected.`,
        );
      }
    }
  }
  return fetchAddressApiUtxos(ownerAddress, ownerNetwork);
}

async function fetchTransactionHex(txid: string, network: BitcoinNetwork) {
  const payload = await fetchProofApiJson<Record<string, unknown>>(
    `/api/v1/tx/${encodeURIComponent(txid)}/hex`,
    network,
  );
  const hex = typeof payload.hex === "string" ? payload.hex.trim() : "";
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/u.test(hex)) {
    throw new Error(`Could not load previous transaction ${shortAddress(txid)}.`);
  }
  return hex;
}

async function fetchBroadcastStatus(txid: string, network: BitcoinNetwork) {
  const payload = await fetchProofApiJson<Record<string, unknown>>(
    `/api/v1/tx/${encodeURIComponent(txid)}/status`,
    network,
  );
  return String(payload.status ?? "").trim().toLowerCase();
}

async function assertConfirmedFundingUtxo(
  utxo: WalletUtxo,
  network: BitcoinNetwork,
) {
  if (utxo.status?.confirmed !== true) {
    throw new Error(
      `Selected wallet output ${shortAddress(utxo.txid)}:${utxo.vout} is not confirmed.`,
    );
  }
  const status = await fetchBroadcastStatus(utxo.txid, network).catch(
    () => "",
  );
  if (status === "pending") {
    throw new Error(
      `Selected wallet output ${shortAddress(utxo.txid)}:${utxo.vout} is pending.`,
    );
  }
}

async function loadUtxoPreviousOutput(
  utxo: WalletUtxo,
  network: BitcoinNetwork,
) {
  await assertConfirmedFundingUtxo(utxo, network);
  const previousTxHex = await fetchTransactionHex(utxo.txid, network);
  const previousTx = bitcoin.Transaction.fromHex(previousTxHex);
  const previousOutput = previousTx.outs[utxo.vout];
  if (!previousOutput) {
    throw new Error(
      `Previous output ${shortAddress(utxo.txid)}:${utxo.vout} could not be read.`,
    );
  }
  return { ...utxo, previousOutput, previousTxHex };
}

function isNativeWitnessScript(script: Uint8Array) {
  const version = script[0];
  const pushLength = script[1];
  return (
    script.length >= 4 &&
    (version === 0x00 || version === 0x51) &&
    pushLength === script.length - 2
  );
}

function utxoInputData(
  utxo: WalletUtxo & {
    previousOutput: bitcoin.Transaction["outs"][number];
    previousTxHex: string;
  },
) {
  if (isNativeWitnessScript(utxo.previousOutput.script)) {
    return {
      witnessUtxo: {
        script: utxo.previousOutput.script,
        value: utxo.previousOutput.value,
      },
    };
  }
  return {
    nonWitnessUtxo: Buffer.from(utxo.previousTxHex, "hex"),
  };
}

function normalizeOutput(
  payment: BoostPaymentOutput,
  index: number,
  label: string,
  network: BitcoinNetwork,
) {
  const amountSats = Math.floor(payment.amountSats);
  if (!Number.isSafeInteger(amountSats) || amountSats < 0) {
    throw new Error(`${label} ${index + 1} has an invalid amount.`);
  }
  if (payment.script) {
    return { amountSats, script: payment.script };
  }
  if (!payment.address) {
    throw new Error(`${label} ${index + 1} is missing an address.`);
  }
  return {
    address: payment.address,
    amountSats,
    script: scriptForAddress(payment.address, network, `${label} ${index + 1}`),
  };
}

function normalizeOutpoint(value: BoostSpentOutpoint) {
  const txid = String(value.txid ?? "").trim().toLowerCase();
  const vout = Math.floor(Number(value.vout));
  return /^[0-9a-f]{64}$/u.test(txid) &&
    Number.isSafeInteger(vout) &&
    vout >= 0
    ? `${txid}:${vout}`
    : "";
}

export async function buildBoostPaymentPsbt({
  excludeOutpoints = [],
  feeRate,
  fromAddress,
  network,
  payments,
  postProtocolPayments = [],
  protocolPayloads,
}: {
  excludeOutpoints?: BoostSpentOutpoint[];
  feeRate: number;
  fromAddress: string;
  network: BitcoinNetwork;
  payments: BoostPaymentOutput[];
  postProtocolPayments?: BoostPaymentOutput[];
  protocolPayloads: string[];
}): Promise<BoostPaymentPsbt> {
  if (payments.length === 0) {
    throw new Error("Add at least one Boost transaction payment.");
  }
  const selectedNetwork = bitcoinNetwork(network);
  const normalizedPayments = payments.map((payment, index) =>
    normalizeOutput(payment, index, "Boost payment", network),
  );
  const normalizedPostProtocolPayments = postProtocolPayments.map(
    (payment, index) =>
      normalizeOutput(payment, index, "Boost anchor payment", network),
  );
  const changeScript = scriptForAddress(
    fromAddress,
    network,
    "Connected wallet",
  );
  const opReturnScripts = protocolPayloads.map(opReturnScriptForPayload);
  const fixedOutputVbytes =
    normalizedPayments.reduce(
      (total, payment) => total + outputVbytesForScript(payment.script),
      0,
    ) +
    opReturnScripts.reduce(
      (total, script) => total + outputVbytesForScript(script),
      0,
    ) +
    normalizedPostProtocolPayments.reduce(
      (total, payment) => total + outputVbytesForScript(payment.script),
      0,
    );
  const changeOutputVbytes = outputVbytesForScript(changeScript);
  const totalAmountSats = [
    ...normalizedPayments,
    ...normalizedPostProtocolPayments,
  ].reduce((total, payment) => total + payment.amountSats, 0);
  const excluded = new Set(
    excludeOutpoints.map(normalizeOutpoint).filter(Boolean),
  );
  const walletUtxos = await fetchUtxos(fromAddress, network);
  const utxos = walletUtxos.filter(
    (utxo) =>
      utxo.status?.confirmed === true &&
      !excluded.has(`${utxo.txid}:${utxo.vout}`),
  );
  if (walletUtxos.length === 0) {
    throw new Error(
      `No spendable UTXOs found for ${shortAddress(fromAddress)} on ${networkLabel(network)}.`,
    );
  }
  if (utxos.length === 0) {
    throw new Error(
      `No confirmed UTXOs found for ${shortAddress(fromAddress)}. Wait for wallet funds to confirm before broadcasting.`,
    );
  }
  const selection = selectUtxos(
    utxos,
    totalAmountSats,
    feeRate,
    fixedOutputVbytes,
    changeOutputVbytes,
  );
  const selectedWithPreviousTx = await Promise.all(
    selection.selected.map((utxo) => loadUtxoPreviousOutput(utxo, network)),
  );
  const psbt = new bitcoin.Psbt({ network: selectedNetwork });
  for (const utxo of selectedWithPreviousTx) {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      ...utxoInputData(utxo),
    });
  }
  for (const payment of normalizedPayments) {
    if (payment.address) {
      psbt.addOutput({
        address: payment.address,
        value: BigInt(payment.amountSats),
      });
    } else {
      psbt.addOutput({
        script: payment.script,
        value: BigInt(payment.amountSats),
      });
    }
  }
  for (const script of opReturnScripts) {
    psbt.addOutput({ script, value: 0n });
  }
  for (const payment of normalizedPostProtocolPayments) {
    if (payment.address) {
      psbt.addOutput({
        address: payment.address,
        value: BigInt(payment.amountSats),
      });
    } else {
      psbt.addOutput({
        script: payment.script,
        value: BigInt(payment.amountSats),
      });
    }
  }
  if (selection.changeSats >= DUST_SATS) {
    psbt.addOutput({
      address: fromAddress,
      value: BigInt(selection.changeSats),
    });
  }
  return {
    changeSats: selection.changeSats,
    dustFeeSats: selection.dustFeeSats,
    feeSats: selection.feeSats,
    inputCount: selection.selected.length,
    outputCount:
      normalizedPayments.length +
      opReturnScripts.length +
      normalizedPostProtocolPayments.length +
      (selection.changeSats >= DUST_SATS ? 1 : 0),
    psbtHex: psbt.toHex(),
    walletInputIndexes: selection.selected.map((_, index) => index),
  };
}

type UnsignedTransactionIntent = {
  inputs: Array<{ hash: string; index: number; sequence: number }>;
  locktime: number;
  outputs: Array<{ script: string; value: string }>;
  version: number;
};

function bytesToHex(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("hex");
}

function psbtUnsignedTransactionIntent(
  psbt: bitcoin.Psbt,
): UnsignedTransactionIntent {
  return {
    inputs: psbt.txInputs.map((input) => ({
      hash: bytesToHex(input.hash),
      index: input.index,
      sequence: input.sequence ?? bitcoin.Transaction.DEFAULT_SEQUENCE,
    })),
    locktime: psbt.locktime,
    outputs: psbt.txOutputs.map((output) => ({
      script: bytesToHex(output.script),
      value: output.value.toString(),
    })),
    version: psbt.version,
  };
}

function rawUnsignedTransactionIntent(
  transaction: bitcoin.Transaction,
): UnsignedTransactionIntent {
  return {
    inputs: transaction.ins.map((input) => ({
      hash: bytesToHex(input.hash),
      index: input.index,
      sequence: input.sequence,
    })),
    locktime: transaction.locktime,
    outputs: transaction.outs.map((output) => ({
      script: bytesToHex(output.script),
      value: output.value.toString(),
    })),
    version: transaction.version,
  };
}

function assertSignedTransactionIntent(
  expected: UnsignedTransactionIntent,
  actual: UnsignedTransactionIntent,
) {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(
      "UniSat changed the transaction inputs, outputs, amounts, fee, version, or locktime. No transaction was broadcast.",
    );
  }
}

function countOpReturnOutputs(rawTx: string, network: BitcoinNetwork) {
  try {
    const transaction = bitcoin.Transaction.fromHex(rawTx);
    return transaction.outs.filter(
      (output) => output.script[0] === bitcoin.opcodes.OP_RETURN,
    ).length;
  } catch {
    const psbt = bitcoin.Psbt.fromHex(rawTx, {
      network: bitcoinNetwork(network),
    });
    const transaction = psbt.extractTransaction();
    return transaction.outs.filter(
      (output) => output.script[0] === bitcoin.opcodes.OP_RETURN,
    ).length;
  }
}

function normalizeBroadcastTxid(value: unknown) {
  const txid = String(value ?? "").trim().toLowerCase();
  return /^[0-9a-f]{64}$/u.test(txid) ? txid : "";
}

function rawTransactionTxid(rawTx: string) {
  try {
    return normalizeBroadcastTxid(bitcoin.Transaction.fromHex(rawTx).getId());
  } catch {
    return "";
  }
}

function knownAcceptedBroadcastMessage(message: string) {
  return /txn-already-in-mempool|already in mempool|already known|already exists|already in block chain|already in blockchain|rpc code\s*-27|code\s*-27/iu.test(
    message,
  );
}

async function postRawTransactionToProofApi(
  rawTx: string,
  network: BitcoinNetwork,
) {
  const response = await fetch(proofApiUrl("/api/v1/broadcast/tx", network), {
    body: JSON.stringify({ txHex: rawTx }),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const responseText = await response.text().catch(() => "");
  let payload: Record<string, unknown> | null = null;
  if (responseText) {
    try {
      const parsed = JSON.parse(responseText);
      payload =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : { message: responseText };
    } catch {
      payload = { message: responseText };
    }
  }
  return {
    ok: response.ok,
    payload,
    responseText,
    status: response.status,
    txid: normalizeBroadcastTxid(
      payload?.txid ?? payload?.txId ?? payload?.result ?? payload?.message,
    ),
  };
}

async function broadcastRawTransaction(
  rawTx: string,
  network: BitcoinNetwork,
): Promise<BoostTransactionBroadcastResult> {
  const opReturnCount = countOpReturnOutputs(rawTx, network);
  const localTxid = rawTransactionTxid(rawTx);
  let lastMessage = "Node broadcast failed.";
  for (
    let attempt = 0;
    attempt <= BROADCAST_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    if (attempt > 0) {
      await delay(BROADCAST_RETRY_DELAYS_MS[attempt - 1]);
    }
    const result = await postRawTransactionToProofApi(rawTx, network).catch(
      (error) => {
        lastMessage = errorMessage(error, "Node broadcast request failed.");
        return null;
      },
    );
    if (result?.ok && result.txid) {
      if (localTxid && result.txid !== localTxid) {
        throw new Error(
          "The ProofOfWork node returned a different transaction ID than the locally signed transaction.",
        );
      }
      return {
        opReturnCount,
        source: "node",
        txid: result.txid,
        url: explorerTxUrl(result.txid, network),
      };
    }
    if (result) {
      lastMessage = String(
        result.payload?.error ??
          result.payload?.message ??
          result.responseText ??
          `Node broadcast failed with HTTP ${result.status}.`,
      );
    }
    if (localTxid && knownAcceptedBroadcastMessage(lastMessage)) {
      return {
        opReturnCount,
        source: "node",
        txid: localTxid,
        url: explorerTxUrl(localTxid, network),
      };
    }
    if (
      !/bad gateway|gateway|upstream|connection reset|timeout|temporarily unavailable|service unavailable|too many requests|failed to fetch|networkerror/iu.test(
        lastMessage,
      ) ||
      attempt >= BROADCAST_RETRY_DELAYS_MS.length
    ) {
      throw new Error(lastMessage);
    }
  }
  throw new Error(lastMessage);
}

export async function signAndBroadcastBoostPsbt({
  inputCount,
  network,
  psbtHex,
  signInputIndexes,
  signingAddress,
  wallet,
}: {
  inputCount: number;
  network: BitcoinNetwork;
  psbtHex: string;
  signInputIndexes?: number[];
  signingAddress: string;
  wallet: UnisatWallet;
}): Promise<BoostTransactionBroadcastResult> {
  if (!wallet.signPsbt) {
    throw new Error(
      "UniSat signPsbt is not available. Update UniSat and try again.",
    );
  }
  const unsignedPsbt = bitcoin.Psbt.fromHex(psbtHex, {
    network: bitcoinNetwork(network),
  });
  const expectedIntent = psbtUnsignedTransactionIntent(unsignedPsbt);
  const requestedInputs = signInputIndexes?.map((index) => ({
    address: signingAddress,
    index,
  }));
  let signedPsbtHex = "";
  try {
    signedPsbtHex = await wallet.signPsbt(
      psbtHex,
      requestedInputs
        ? { autoFinalized: true, toSignInputs: requestedInputs }
        : { autoFinalized: true },
    );
  } catch (error) {
    const signFailure = errorMessage(error, "");
    if (
      !/(tosigninput|sign input|matched|current address)/iu.test(signFailure)
    ) {
      throw error;
    }
    const publicKey = await wallet.getPublicKey?.().catch(() => "");
    if (!publicKey) {
      throw error;
    }
    signedPsbtHex = await wallet.signPsbt(psbtHex, {
      autoFinalized: true,
      toSignInputs: (
        signInputIndexes ?? Array.from({ length: inputCount }, (_, index) => index)
      ).map((index) => ({ index, publicKey })),
    });
  }
  const signedPsbt = bitcoin.Psbt.fromHex(signedPsbtHex, {
    network: bitcoinNetwork(network),
  });
  assertSignedTransactionIntent(
    expectedIntent,
    psbtUnsignedTransactionIntent(signedPsbt),
  );
  const signedTransaction = signedPsbt.extractTransaction();
  assertSignedTransactionIntent(
    expectedIntent,
    rawUnsignedTransactionIntent(signedTransaction),
  );
  return broadcastRawTransaction(signedTransaction.toHex(), network);
}

function listingAnchorOutpoint(value: unknown): BoostSpentOutpoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const listing = value as Record<string, unknown>;
  const authorization =
    listing.saleAuthorization &&
    typeof listing.saleAuthorization === "object" &&
    !Array.isArray(listing.saleAuthorization)
      ? (listing.saleAuthorization as Record<string, unknown>)
      : {};
  const listingId = normalizeHexTxid(listing.listingId);
  const anchorTxid = normalizeHexTxid(authorization.anchorTxid);
  const saleTicketVout = Number(
    authorization.anchorVout ?? authorization.saleTicketVout ?? 2,
  );
  const vout =
    Number.isSafeInteger(saleTicketVout) && saleTicketVout >= 0
      ? saleTicketVout
      : 2;
  if (anchorTxid) {
    return { txid: anchorTxid, vout };
  }
  return listingId ? { txid: listingId, vout } : null;
}

function normalizeHexTxid(value: unknown) {
  const txid = String(value ?? "").trim().toLowerCase();
  return /^[0-9a-f]{64}$/u.test(txid) ? txid : "";
}

function uniqueOutpoints(outpoints: Array<BoostSpentOutpoint | null>) {
  const byKey = new Map<string, BoostSpentOutpoint>();
  for (const outpoint of outpoints) {
    if (!outpoint) {
      continue;
    }
    const key = normalizeOutpoint(outpoint);
    if (key) {
      byKey.set(key, {
        txid: outpoint.txid.toLowerCase(),
        vout: Math.floor(outpoint.vout),
      });
    }
  }
  return [...byKey.values()];
}

export async function fetchReservedAmoAnchorOutpoints(
  address: string,
  network: BitcoinNetwork,
  additional: BoostSpentOutpoint[] = [],
) {
  const normalizedAddress = address.trim().toLowerCase();
  if (!normalizedAddress) {
    return [];
  }
  const registryPayload = await fetchProofApiJson<Record<string, unknown>>(
    "/api/v1/registry?fresh=1",
    network,
  ).catch(() => null);
  const tokenPayload =
    network === "livenet"
      ? await fetchProofApiJson<Record<string, unknown>>(
          `/api/v1/token?${new URLSearchParams({
            address,
            wallet: "1",
          }).toString()}`,
          network,
        ).catch(() => null)
      : null;
  const registryListings = Array.isArray(registryPayload?.listings)
    ? registryPayload.listings
    : [];
  const tokenListings = Array.isArray(tokenPayload?.listings)
    ? tokenPayload.listings
    : [];
  const ownedListings = [...registryListings, ...tokenListings].filter(
    (listing) =>
      listing &&
      typeof listing === "object" &&
      !Array.isArray(listing) &&
      String((listing as Record<string, unknown>).sellerAddress ?? "")
        .trim()
        .toLowerCase() === normalizedAddress,
  );
  return uniqueOutpoints([
    ...additional,
    ...ownedListings.map(listingAnchorOutpoint),
  ]);
}
