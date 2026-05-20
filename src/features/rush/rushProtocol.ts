import type { BitcoinNetwork } from "../../shared/bitcoin/networks";

export const RUSH_APP_URL = "https://rush.proofofwork.me";
export const RUSH_PROTOCOL_PREFIX = "pwr1:";
export const RUSH_MINT_PAYLOAD = "pwr1:m:rush";
export const RUSH_TICKER = "RUSH";
export const RUSH_DECIMALS = 6;
export const RUSH_BASE_UNITS = 1_000_000n;
export const RUSH_TOTAL_SUPPLY = 1_000_000_000n;
export const RUSH_TOTAL_SUPPLY_UNITS = RUSH_TOTAL_SUPPLY * RUSH_BASE_UNITS;
export const RUSH_MAX_REWARDED_MINTS = 50_000;
export const RUSH_MINT_PRICE_SATS = 1000;
export const RUSH_CHAINED_MINT_DEFAULT_COUNT = 5;
export const RUSH_CHAINED_MINT_MAX_COUNT = 20;
export const RUSH_CHAINED_MINT_DEFAULT_DELAY_MS = 500;
export const RUSH_CHAINED_MINT_MAX_DELAY_MS = 30_000;

export const RUSH_REGISTRY_ADDRESSES: Partial<Record<BitcoinNetwork, string>> =
  {
    livenet: "bc1qym392dfvfm024k7ukzlnvnpfvuu4kfqvu56w3e",
    testnet4: "tb1qyh9pgznpass4mjcl8qj9yxs3vvl9rnrk5gvw6q",
  };

export type RushPhase = {
  endOrdinal: number;
  phase: number;
  reward: string;
  rewardUnits: string;
  startOrdinal: number;
  total: string;
  totalUnits: string;
};

export const RUSH_PHASES: RushPhase[] = [
  {
    endOrdinal: 5000,
    phase: 1,
    reward: "50000",
    rewardUnits: "50000000000",
    startOrdinal: 1,
    total: "250000000",
    totalUnits: "250000000000000",
  },
  {
    endOrdinal: 15000,
    phase: 2,
    reward: "30000",
    rewardUnits: "30000000000",
    startOrdinal: 5001,
    total: "300000000",
    totalUnits: "300000000000000",
  },
  {
    endOrdinal: 30000,
    phase: 3,
    reward: "18000",
    rewardUnits: "18000000000",
    startOrdinal: 15001,
    total: "270000000",
    totalUnits: "270000000000000",
  },
  {
    endOrdinal: 45000,
    phase: 4,
    reward: "10000",
    rewardUnits: "10000000000",
    startOrdinal: 30001,
    total: "150000000",
    totalUnits: "150000000000000",
  },
  {
    endOrdinal: 50000,
    phase: 5,
    reward: "6000",
    rewardUnits: "6000000000",
    startOrdinal: 45001,
    total: "30000000",
    totalUnits: "30000000000000",
  },
];

export type RushMintRecord = {
  amount: string;
  amountUnits: string;
  confirmed: boolean;
  createdAt: string;
  dataBytes?: number;
  minterAddress: string;
  network: BitcoinNetwork;
  ordinal?: number;
  overflow: boolean;
  paidSats: number;
  phase?: number;
  registryAddress: string;
  txid: string;
};

export type RushStats = {
  confirmedMints: number;
  currentPhase: number | null;
  distributed: string;
  nextOrdinal: number | null;
  nextReward: string;
  overflowMints: number;
  pendingMints: number;
  remaining: string;
  rewardedMints: number;
  totalSupply: "1000000000";
};

export type RushState = {
  indexedAt: string;
  mints: RushMintRecord[];
  network: BitcoinNetwork;
  registryAddress: string;
  stats: RushStats;
};

export function rushRegistryAddressForNetwork(network: BitcoinNetwork) {
  return RUSH_REGISTRY_ADDRESSES[network] ?? "";
}

export function buildRushMintPayload() {
  return RUSH_MINT_PAYLOAD;
}

export function rushPhaseForOrdinal(ordinal: number) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
    return undefined;
  }

  return RUSH_PHASES.find(
    (phase) => ordinal >= phase.startOrdinal && ordinal <= phase.endOrdinal,
  );
}

export function rushRewardUnitsForOrdinal(ordinal: number) {
  const phase = rushPhaseForOrdinal(ordinal);
  return phase ? BigInt(phase.rewardUnits) : 0n;
}

export function formatRushUnits(units: bigint) {
  const sign = units < 0n ? "-" : "";
  const absolute = units < 0n ? -units : units;
  const whole = absolute / RUSH_BASE_UNITS;
  const fractional = absolute % RUSH_BASE_UNITS;
  if (fractional === 0n) {
    return `${sign}${whole.toString()}`;
  }

  const decimals = fractional
    .toString()
    .padStart(RUSH_DECIMALS, "0")
    .replace(/0+$/u, "");
  return `${sign}${whole.toString()}.${decimals}`;
}

export function rushRewardForOrdinal(ordinal: number) {
  return formatRushUnits(rushRewardUnitsForOrdinal(ordinal));
}

export function emptyRushStats(): RushStats {
  return {
    confirmedMints: 0,
    currentPhase: 1,
    distributed: "0",
    nextOrdinal: 1,
    nextReward: rushRewardForOrdinal(1),
    overflowMints: 0,
    pendingMints: 0,
    remaining: RUSH_TOTAL_SUPPLY.toString(),
    rewardedMints: 0,
    totalSupply: "1000000000",
  };
}

export function emptyRushState(network: BitcoinNetwork = "livenet"): RushState {
  return {
    indexedAt: new Date(0).toISOString(),
    mints: [],
    network,
    registryAddress: RUSH_REGISTRY_ADDRESSES[network] ?? "",
    stats: emptyRushStats(),
  };
}

export function rushStatsFromMints(mints: RushMintRecord[]): RushStats {
  const confirmedMints = mints.filter((mint) => mint.confirmed).length;
  const pendingMints = mints.filter((mint) => !mint.confirmed).length;
  const rewardedMints = Math.min(confirmedMints, RUSH_MAX_REWARDED_MINTS);
  const overflowMints = Math.max(0, confirmedMints - RUSH_MAX_REWARDED_MINTS);
  const distributedUnits = mints.reduce((total, mint) => {
    if (!mint.confirmed || mint.overflow) {
      return total;
    }

    return total + BigInt(mint.amountUnits || "0");
  }, 0n);
  const remainingUnits =
    distributedUnits >= RUSH_TOTAL_SUPPLY_UNITS
      ? 0n
      : RUSH_TOTAL_SUPPLY_UNITS - distributedUnits;
  const nextOrdinal =
    rewardedMints >= RUSH_MAX_REWARDED_MINTS ? null : rewardedMints + 1;
  const nextPhase = nextOrdinal ? rushPhaseForOrdinal(nextOrdinal) : undefined;

  return {
    confirmedMints,
    currentPhase: nextPhase?.phase ?? null,
    distributed: formatRushUnits(distributedUnits),
    nextOrdinal,
    nextReward: nextOrdinal ? rushRewardForOrdinal(nextOrdinal) : "0",
    overflowMints,
    pendingMints,
    remaining: formatRushUnits(remainingUnits),
    rewardedMints,
    totalSupply: "1000000000",
  };
}

export function rushPhaseProgress(stats: RushStats) {
  if (!stats.nextOrdinal) {
    return 100;
  }

  const phase = rushPhaseForOrdinal(stats.nextOrdinal);
  if (!phase) {
    return 100;
  }

  const span = phase.endOrdinal - phase.startOrdinal + 1;
  const complete = Math.max(0, stats.nextOrdinal - phase.startOrdinal);
  return Math.min(100, Math.round((complete / span) * 100));
}

export function rushMintProgress(stats: RushStats) {
  return Math.min(
    100,
    Math.round((stats.rewardedMints / RUSH_MAX_REWARDED_MINTS) * 100),
  );
}
