const DEFAULT_COMPACT_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_SQL_TEXT_MAX_BYTES = 18 * 1024 * 1024;
const MAX_COMPACT_MAX_BYTES = 64 * 1024 * 1024;
const MAX_SQL_TEXT_MAX_BYTES = 72 * 1024 * 1024;

function boundedByteBudget(value, fallback, minimum, maximum) {
  const parsed = Math.floor(Number(value));
  const selected = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return Math.max(minimum, Math.min(maximum, selected));
}

export function canonicalSummarySnapshotMaxBytes(env = process.env) {
  return boundedByteBudget(
    env?.POW_INDEX_CANONICAL_SUMMARY_SNAPSHOT_MAX_BYTES,
    DEFAULT_COMPACT_MAX_BYTES,
    DEFAULT_COMPACT_MAX_BYTES,
    MAX_COMPACT_MAX_BYTES,
  );
}

export function canonicalSummarySnapshotSqlTextMaxBytes(env = process.env) {
  const compactMaxBytes = canonicalSummarySnapshotMaxBytes(env);
  const defaultSqlTextMaxBytes = Math.max(
    DEFAULT_SQL_TEXT_MAX_BYTES,
    Math.ceil(compactMaxBytes * 9 / 8),
  );
  return boundedByteBudget(
    env?.POW_INDEX_CANONICAL_SUMMARY_SNAPSHOT_SQL_TEXT_MAX_BYTES,
    defaultSqlTextMaxBytes,
    compactMaxBytes,
    MAX_SQL_TEXT_MAX_BYTES,
  );
}
