import {
  normalizeWorkMailBatchDeclarationPins,
  WORK_MAIL_BATCH_MIN_DECLARATION_BLOCK_HEIGHT,
  workMailBatchActivationFromEvidence,
  workMailBatchDeclarationEvidenceFromTransaction,
  workMailBatchDeclarationStatus,
} from "./work-mail-batch-declaration.mjs";
import {
  WORK_MAIL_BATCH_MAX_PAYLOAD_BYTES, WORK_MAIL_BATCH_MAX_RECIPIENTS,
  WORK_MAIL_BATCH_MIN_RECIPIENTS, WORK_MAIL_BATCH_REGISTRY_FEE_PROOFS,
} from "../src/shared/protocol/workMailBatch.mjs";

/** Pins are control metadata, never evidence of confirmation or authority. */
export function workMailBatchConfiguration(environment = {}) {
  const names = {
    txid: "TXID", blockHeight: "HEIGHT", blockHash: "BLOCK_HASH",
    blockTransactionIndex: "BLOCK_INDEX", protocolVout: "PROTOCOL_VOUT",
    recordOrdinal: "RECORD_ORDINAL", registryPaymentVout: "REGISTRY_PAYMENT_VOUT",
  };
  const requested = Object.values(names).some((name) =>
    String(environment[`WORK_MAIL_BATCH_DECLARATION_${name}`] ?? "").trim()) ||
    Boolean(String(environment.WORK_MAIL_BATCH_ACTIVATION_HEIGHT ?? "").trim());
  const candidate = Object.fromEntries(Object.entries(names).map(([key, name]) => {
    const value = String(environment[`WORK_MAIL_BATCH_DECLARATION_${name}`] ?? "").trim();
    return [key, key === "txid" || key === "blockHash" ? value :
      /^(?:0|[1-9][0-9]*)$/u.test(value) ? Number(value) : Number.NaN];
  }));
  const activation = String(environment.WORK_MAIL_BATCH_ACTIVATION_HEIGHT ?? "").trim();
  candidate.activationHeight = /^[1-9][0-9]*$/u.test(activation) ? Number(activation) : Number.NaN;
  return Object.freeze({
    requested: Boolean(requested), pins: normalizeWorkMailBatchDeclarationPins(candidate),
    writesEnabled: Boolean(requested) && environment.WORK_MAIL_BATCH_WRITES_ENABLED === "1",
  });
}

/** Marker lookup includes the missing-marker/sealed-history guard. Discovery is
 * allowed only after that guard succeeds; it can establish reads, never writes. */
export async function resolveWorkMailBatchReadConfiguration({ configuration, readMarker, discover, maximumBlockHeight = null } = {}) {
  if (configuration?.requested && !normalizeWorkMailBatchDeclarationPins(configuration.pins)) {
    throw new Error("work-mail-batch-declaration-pins-invalid");
  }
  const marker = await readMarker();
  if (marker) {
    const pins = normalizeWorkMailBatchDeclarationPins(marker.declaration);
    if (!pins) throw new Error("work-mail-batch-activation-marker-invalid");
    if (configuration?.requested) {
      const configured = normalizeWorkMailBatchDeclarationPins(configuration.pins);
      if (!configured || JSON.stringify(configured) !== JSON.stringify(pins)) {
        throw new Error("work-mail-batch-configured-marker-mismatch");
      }
      return configuration;
    }
    return { requested: true, pins, writesEnabled: false };
  }
  if (maximumBlockHeight !== null && (!Number.isSafeInteger(maximumBlockHeight) || maximumBlockHeight < 1)) {
    throw new Error("work-mail-batch-discovery-boundary-invalid");
  }
  if (maximumBlockHeight !== null && maximumBlockHeight < WORK_MAIL_BATCH_MIN_DECLARATION_BLOCK_HEIGHT) {
    return configuration?.requested ? configuration : { requested: false, pins: null, writesEnabled: false };
  }
  // Shape-valid future pins must not suppress an earlier authority already
  // present in H-minus-one. Discover before deciding this block is prebatch.
  const discovered = await discover();
  const pins = discovered ? normalizeWorkMailBatchDeclarationPins(discovered) : null;
  if (discovered && !pins) throw new Error("work-mail-batch-discovered-pins-invalid");
  if (configuration?.requested) {
    const configured = normalizeWorkMailBatchDeclarationPins(configuration.pins);
    if (pins && JSON.stringify(configured) !== JSON.stringify(pins)) {
      throw new Error("work-mail-batch-pins-not-earliest-canonical-declaration");
    }
    if (!pins && (maximumBlockHeight === null || maximumBlockHeight >= configured.blockHeight)) {
      throw new Error("work-mail-batch-declaration-not-discovered");
    }
    return configuration;
  }
  return { requested: Boolean(pins), pins, writesEnabled: false };
}

/** Dependencies must use the first-party canonical node, never client claims. */
export async function loadWorkMailBatchActivation({ configuration, blockHeight, blockHash,
  getBlockHash, getBlock, getTransaction } = {}) {
  const { pins, requested } = configuration ?? {};
  if (!pins) {
    if (requested) throw new Error("work-mail-batch-declaration-pins-invalid");
    return { active: false, reasonCode: "work-mail-batch-declaration-unconfigured" };
  }
  if (!Number.isSafeInteger(blockHeight) || blockHeight < 1 ||
      !/^[0-9a-f]{64}$/u.test(blockHash ?? "")) {
    throw new Error("work-mail-batch-canonical-checkpoint-required");
  }
  if (blockHeight < pins.activationHeight) {
    return { active: false, activationHeight: pins.activationHeight,
      reasonCode: "work-mail-batch-activation-not-indexed" };
  }
  const [checkpointHash, declarationHash, block, transaction] = await Promise.all([
    getBlockHash(blockHeight), getBlockHash(pins.blockHeight),
    getBlock(pins.blockHash), getTransaction(pins.txid),
  ]);
  if (checkpointHash !== blockHash || declarationHash !== pins.blockHash ||
      block?.hash !== pins.blockHash || block?.height !== pins.blockHeight ||
      block?.tx?.[pins.blockTransactionIndex] !== pins.txid) {
    throw new Error("work-mail-batch-declaration-canonical-fence-mismatch");
  }
  if (transaction?.status?.block_height !== undefined &&
      transaction.status.block_height !== block.height) {
    throw new Error("work-mail-batch-declaration-transaction-height-mismatch");
  }
  // Core getrawtransaction commonly omits height. The independently verified
  // canonical block membership above supplies it; a caller claim never does.
  const evidence = workMailBatchDeclarationEvidenceFromTransaction(
    { ...transaction, status: { ...transaction?.status, block_height: block.height },
      _powBlockIndex: pins.blockTransactionIndex }, pins, { canonical: true },
  );
  const activation = workMailBatchActivationFromEvidence(evidence, {
    expectedDeclaration: pins, indexedThroughBlock: blockHeight,
  });
  if (!activation.active) throw new Error(activation.reasonCode);
  // Fence again after hydration: a reorg must not validate evidence from two chains.
  if (await getBlockHash(blockHeight) !== blockHash) {
    throw new Error("work-mail-batch-canonical-checkpoint-changed");
  }
  return { ...activation, evidence };
}

export function workMailBatchPublicStatus({ configuration, activation, tip,
  replayReady = false, exactTipReady = false, reasonCode } = {}) {
  const status = workMailBatchDeclarationStatus({
    evidence: activation?.evidence, expectedDeclaration: configuration?.pins,
    indexedThroughBlock: tip?.height, writesEnabled: configuration?.writesEnabled,
    replayReady, exactTipReady,
  });
  return {
    protocol: "work-mail-batch-v1", network: "livenet",
    active: status.active === true, writeEnabled: configuration?.writesEnabled === true,
    ready: status.writesAllowed === true && !reasonCode,
    reasonCode: reasonCode || status.reasonCode || null,
    declarationTxid: configuration?.pins?.txid ?? null,
    activationHeight: configuration?.pins?.activationHeight ?? null,
    checkedTipHeight: tip?.height ?? 0, checkedTipHash: tip?.blockHash ?? "",
    limits: { minRecipients: WORK_MAIL_BATCH_MIN_RECIPIENTS,
      maxRecipients: WORK_MAIL_BATCH_MAX_RECIPIENTS, maxPayloadBytes: WORK_MAIL_BATCH_MAX_PAYLOAD_BYTES },
    registryFeeProofs: WORK_MAIL_BATCH_REGISTRY_FEE_PROOFS,
  };
}
