export type BoostGrowthCounts = Record<
  "events" | "transactions" | "posts" | "replies" | "likes" | "reboosts" |
  "follows" | "unfollows" | "profiles" | "hides" | "transfers" | "listings" |
  "seals" | "delistings" | "sales" | "socialActions", number>;
export type BoostGrowthAmount = "directProofSignalSats" | "registryFeeSats" |
  "saleVolumeSats" | "attachedWorkSubatoms" | "attributedMailSats" | "attributedWorkSubatoms";
export type BoostGrowthCheckpoint = { blockHeight: number; blockHash: string; snapshotId: string };
export type BoostGrowthObservation = Record<BoostGrowthAmount, string | null> & {
  model: string;
  source: string;
  countScope: string;
  ready: boolean;
  complete: boolean;
  reason: string | null;
  economicMetricsVerified: boolean;
  checkpoint: BoostGrowthCheckpoint | null;
  counts: BoostGrowthCounts | null;
  metricReasons: Partial<Record<BoostGrowthAmount, string>>;
};
export const BOOST_GROWTH_COUNT_FIELDS: Array<keyof BoostGrowthCounts>;
export const BOOST_GROWTH_AMOUNT_FIELDS: BoostGrowthAmount[];
export function normalizeBoostGrowth(value: unknown, checkpoint: unknown): BoostGrowthObservation;
export function boostProofsDisplay(value: string | null): string;
export function boostWorkDisplay(value: string | null): string;
