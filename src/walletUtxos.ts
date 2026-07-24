export type WalletUtxoSource =
  | "api"
  | "wallet-curated"
  | "wallet-generic";

export type WalletUtxo = {
  source?: WalletUtxoSource;
  status?: {
    confirmed?: boolean;
  };
  txid: string;
  value: number;
  vout: number;
};

export type WalletUtxoSelection = {
  changeSats: number;
  dustFeeSats: number;
  feeSats: number;
  selected: WalletUtxo[];
};

const DEFAULT_DUST_SATS = 546;
const DEFAULT_ESTIMATED_INPUT_VBYTES = 160;

function sortWalletUtxos(utxos: WalletUtxo[]) {
  return [...utxos].sort((left, right) => {
    const byConfirmation =
      Number(Boolean(right.status?.confirmed)) -
      Number(Boolean(left.status?.confirmed));
    return (
      byConfirmation ||
      right.value - left.value ||
      left.txid.localeCompare(right.txid) ||
      left.vout - right.vout
    );
  });
}

export function estimateTxVbytes(
  inputCount: number,
  outputVbytes: number,
  estimatedInputVbytes = DEFAULT_ESTIMATED_INPUT_VBYTES,
) {
  return 10 + inputCount * estimatedInputVbytes + outputVbytes;
}

export function selectUtxos(
  utxos: WalletUtxo[],
  amountSats: number,
  feeRate: number,
  fixedOutputVbytes: number,
  changeOutputVbytes: number,
  baseInputCount = 0,
  dustSats = DEFAULT_DUST_SATS,
): WalletUtxoSelection {
  const selected: WalletUtxo[] = [];
  let selectedValue = 0;

  for (const utxo of utxos) {
    selected.push(utxo);
    selectedValue += utxo.value;

    const feeWithChange = Math.ceil(
      estimateTxVbytes(
        selected.length + baseInputCount,
        fixedOutputVbytes + changeOutputVbytes,
      ) * feeRate,
    );
    const changeWithChange = selectedValue - amountSats - feeWithChange;
    if (changeWithChange >= dustSats) {
      return {
        selected,
        dustFeeSats: 0,
        feeSats: feeWithChange,
        changeSats: changeWithChange,
      };
    }

    const feeWithoutChange = Math.ceil(
      estimateTxVbytes(
        selected.length + baseInputCount,
        fixedOutputVbytes,
      ) * feeRate,
    );
    const remainder = selectedValue - amountSats - feeWithoutChange;
    if (remainder >= 0) {
      return {
        selected,
        dustFeeSats: remainder,
        feeSats: feeWithoutChange + remainder,
        changeSats: 0,
      };
    }
  }

  const lastInputCount = Math.max(selected.length, 1) + baseInputCount;
  const estimatedFee = Math.ceil(
    estimateTxVbytes(
      lastInputCount,
      fixedOutputVbytes + changeOutputVbytes,
    ) * feeRate,
  );
  throw new Error(
    `Insufficient funds. Need about ${(amountSats + estimatedFee).toLocaleString()} proofs for amount plus fee.`,
  );
}

export function selectSmallestSingleConfirmedUtxo(
  utxos: WalletUtxo[],
  amountSats: number,
  feeRate: number,
  fixedOutputVbytes: number,
  changeOutputVbytes: number,
) {
  const candidates = utxos
    .filter(
      (utxo) =>
        utxo.status?.confirmed === true &&
        utxo.source === "wallet-curated",
    )
    .sort(
      (left, right) =>
        left.value - right.value ||
        left.txid.localeCompare(right.txid) ||
        left.vout - right.vout,
    );

  for (const candidate of candidates) {
    try {
      return selectUtxos(
        [candidate],
        amountSats,
        feeRate,
        fixedOutputVbytes,
        changeOutputVbytes,
      );
    } catch {
      // The caller retains its normal multi-input fallback.
    }
  }

  return undefined;
}

function hasAttachedWalletAssets(value: unknown) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return Boolean(value);
}

export function normalizeWalletUtxos(
  rawUtxos: Array<Record<string, unknown>>,
  source: WalletUtxoSource,
) {
  return sortWalletUtxos(
    rawUtxos.flatMap((utxo): WalletUtxo[] => {
      if (
        hasAttachedWalletAssets(utxo.inscriptions) ||
        hasAttachedWalletAssets(utxo.atomicals)
      ) {
        return [];
      }

      const txid =
        typeof utxo.txid === "string"
          ? utxo.txid
          : typeof utxo.txId === "string"
            ? utxo.txId
            : typeof utxo.tx_hash === "string"
              ? utxo.tx_hash
              : "";
      const normalizedTxid = txid.toLowerCase();
      const vout = Number(utxo.vout ?? utxo.outputIndex ?? utxo.tx_pos ?? -1);
      const value = Number(
        utxo.value ?? utxo.satoshis ?? utxo.satoshi ?? utxo.amount ?? 0,
      );

      if (
        !/^[0-9a-f]{64}$/.test(normalizedTxid) ||
        !Number.isSafeInteger(vout) ||
        vout < 0 ||
        !Number.isSafeInteger(value) ||
        value <= 0
      ) {
        return [];
      }

      const rawStatus =
        utxo.status && typeof utxo.status === "object"
          ? (utxo.status as WalletUtxo["status"])
          : undefined;
      const confirmations = Number(utxo.confirmations);
      const blockHeight = Number(
        utxo.height ?? utxo.blockHeight ?? utxo.block_height,
      );
      const confirmed =
        typeof rawStatus?.confirmed === "boolean"
          ? rawStatus.confirmed
          : typeof utxo.confirmed === "boolean"
            ? utxo.confirmed
            : Number.isFinite(confirmations)
              ? confirmations > 0
              : Number.isSafeInteger(blockHeight) && blockHeight > 0
                ? true
                : undefined;
      const status =
        rawStatus || typeof confirmed === "boolean"
          ? {
              ...(rawStatus ?? {}),
              ...(typeof confirmed === "boolean" ? { confirmed } : {}),
            }
          : undefined;

      return [{ source, status, txid: normalizedTxid, value, vout }];
    }),
  );
}

export function enrichWalletCuratedUtxoConfirmations(
  utxos: WalletUtxo[],
  statusEvidence: WalletUtxo[],
) {
  const confirmations = new Map(
    statusEvidence.flatMap((utxo): Array<[string, boolean]> =>
      typeof utxo.status?.confirmed === "boolean"
        ? [[`${utxo.txid}:${utxo.vout}`, utxo.status.confirmed]]
        : [],
    ),
  );

  return sortWalletUtxos(
    utxos.map((utxo) => {
      const confirmed = confirmations.get(`${utxo.txid}:${utxo.vout}`);
      if (
        utxo.source !== "wallet-curated" ||
        typeof utxo.status?.confirmed === "boolean" ||
        typeof confirmed !== "boolean"
      ) {
        return utxo;
      }
      return {
        ...utxo,
        source: "wallet-curated",
        status: {
          ...(utxo.status ?? {}),
          confirmed,
        },
      };
    }),
  );
}
