import { fetchProofApiJson } from "../../shared/api/proofApiClient";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";
import { JOBS_ACTIVATION_HEIGHT, JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH } from "../../shared/protocol/jobs.mjs";

export type JobAction = "brief" | "propose" | "assign" | "deliver" | "accept" | "cancel";
export type JobStatus = "open" | "assigned" | "delivered" | "paid" | "cancelled";
export type JobSnapshot = { id: string; checkpointHeight: number; checkpointHash: string };
export type Job = {
  txid: string; title: string; brief: string; scope: string; rewardSats: string; offeredRewardSats: string;
  requesterAddress: string; requesterId?: string; status: JobStatus; headTxid: string;
  workerAddress: string; workerId?: string; proposalTxid: string; assignmentTxid: string;
  deliveryTxid: string; acceptanceTxid: string; paymentTxid: string; paidSats: string;
  blockHeight: number; blockHash: string; blockTransactionIndex: number; blockTime: number | string | null;
};
export type JobEvent = {
  txid: string; action: JobAction | "invalid"; authorAddress: string; metadata: Record<string, unknown>;
  valid: boolean; applied: boolean; validationErrors: string[]; confirmed: boolean;
  blockHeight: number; blockHash: string; blockTransactionIndex: number; blockTime: number | string | null;
  protocolVout: number; amountSats: string; jobTxid: string;
  rawBody?: string;
};
export type JobPagination = { hasMore: boolean; nextCursor?: string | null; total?: number; limit?: number };
export type JobsEvidence = {
  network: BitcoinNetwork; complete: true; source: string; snapshot: JobSnapshot;
  indexedThroughBlock: number; indexedThroughBlockHash: string;
  activationHeight: number; activationPreviousBlockHash: string;
  pendingComplete?: boolean; pendingEvents?: JobEvent[];
};
export type JobsStats = { jobs?: number; open?: number; assigned?: number; delivered?: number; paid?: number; cancelled?: number; paidSats?: string; [key: string]: unknown };
export type JobsList = JobsEvidence & { jobs: Job[]; pagination: JobPagination; stats?: JobsStats };
export type JobDetail = JobsEvidence & {
  job: Job; events: JobEvent[]; proposals: JobEvent[]; deliveries: JobEvent[];
  eventsComplete: true; proposalsComplete: true; deliveriesComplete: true;
};
export const JOB_TXID = /^[a-f0-9]{64}$/u;
export const JOB_STATUSES: JobStatus[] = ["open", "assigned", "delivered", "paid", "cancelled"];
export function exactProofs(value: unknown, minimum = 0n): value is string {
  return typeof value === "string" && /^(?:0|[1-9][0-9]{0,15})$/u.test(value) && BigInt(value) >= minimum && BigInt(value) <= 2100000000000000n;
}
export function assertJobsEvidence(value: JobsEvidence, network: BitcoinNetwork) {
  if (!value || value.network !== network || value.complete !== true || value.source !== "proof-indexer-exact-canonical-jobs-replay" ||
    value.activationHeight !== JOBS_ACTIVATION_HEIGHT || value.activationPreviousBlockHash !== JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH ||
    !value.snapshot?.id?.trim() || !Number.isSafeInteger(value.indexedThroughBlock) || value.indexedThroughBlock < JOBS_ACTIVATION_HEIGHT - 1 ||
    !JOB_TXID.test(value.indexedThroughBlockHash) || value.snapshot.checkpointHeight !== value.indexedThroughBlock ||
    value.snapshot.checkpointHash !== value.indexedThroughBlockHash ||
    (value.indexedThroughBlock === JOBS_ACTIVATION_HEIGHT - 1 && value.indexedThroughBlockHash !== JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH)) {
    throw new Error("Complete confirmed Jobs evidence is unavailable. Refresh before continuing.");
  }
}
export function assertJob(job: Job) {
  if (!job || !JOB_TXID.test(job.txid) || !JOB_TXID.test(job.headTxid) || !JOB_STATUSES.includes(job.status) ||
    [job.title, job.brief, job.scope, job.requesterAddress, job.workerAddress].some(value => typeof value !== "string") ||
    !job.requesterAddress || !exactProofs(job.rewardSats, 546n) || !exactProofs(job.offeredRewardSats, 546n) || !exactProofs(job.paidSats) ||
    !Number.isSafeInteger(job.blockHeight) || job.blockHeight < JOBS_ACTIVATION_HEIGHT || !JOB_TXID.test(job.blockHash) ||
    !Number.isSafeInteger(job.blockTransactionIndex) || job.blockTransactionIndex < 0 ||
    [job.proposalTxid, job.assignmentTxid, job.deliveryTxid, job.acceptanceTxid, job.paymentTxid].some(value => typeof value !== "string" || (value !== "" && !JOB_TXID.test(value)))) {
    throw new Error("Job terms or lifecycle evidence are incomplete. Refresh before continuing.");
  }
  if (job.status !== "open" && job.status !== "cancelled" && (!job.workerAddress || !job.proposalTxid || !job.assignmentTxid)) throw new Error("Confirmed assignment evidence is unavailable.");
  if (["delivered", "paid"].includes(job.status) && !job.deliveryTxid) throw new Error("Confirmed delivery evidence is unavailable.");
  if (job.status === "paid" && (!job.acceptanceTxid || job.paymentTxid !== job.acceptanceTxid || job.paidSats !== job.rewardSats)) throw new Error("Exact acceptance payment evidence is unavailable.");
  if (job.status !== "paid" && (job.paidSats !== "0" || job.acceptanceTxid || job.paymentTxid)) throw new Error("Unpaid job contains inconsistent acceptance payment evidence.");
}
function assertEvent(event: JobEvent) {
  if (!event || !JOB_TXID.test(event.txid) || !["brief", "propose", "assign", "deliver", "accept", "cancel", "invalid"].includes(event.action) ||
    typeof event.authorAddress !== "string" || (event.valid && (!event.metadata || typeof event.metadata !== "object" || Array.isArray(event.metadata))) ||
    typeof event.valid !== "boolean" || typeof event.applied !== "boolean" || event.confirmed !== true || !Array.isArray(event.validationErrors) ||
    event.validationErrors.some(value => typeof value !== "string") || (event.applied && !event.valid) ||
    (event.valid && (!event.authorAddress || event.action === "invalid")) ||
    !exactProofs(event.amountSats) || !Number.isSafeInteger(event.blockHeight) || event.blockHeight < 0 || !JOB_TXID.test(event.blockHash)) {
    throw new Error("Confirmed job history evidence is incomplete.");
  }
}
export async function fetchJobs(network: BitcoinNetwork, params: { q?: string; status?: string; address?: string; cursor?: string; snapshot?: string; fresh?: boolean; signal?: AbortSignal } = {}) {
  const query = new URLSearchParams({ limit: "30" });
  for (const key of ["q", "status", "address", "cursor", "snapshot"] as const) if (params[key]) query.set(key, params[key]!);
  if (params.fresh) query.set("fresh", "1");
  const value = await fetchProofApiJson<JobsList>(`/api/v1/jobs?${query}`, network, { signal: params.signal });
  assertJobsEvidence(value, network);
  if (!Array.isArray(value.jobs) || !value.pagination || typeof value.pagination.hasMore !== "boolean" ||
    (value.pagination.hasMore && !value.pagination.nextCursor) || (params.snapshot && value.snapshot.id !== params.snapshot)) throw new Error("Complete Jobs pagination is unavailable. Refresh the board.");
  value.jobs.forEach(assertJob);
  if (value.jobs.some(job => job.blockHeight > value.indexedThroughBlock)) throw new Error("Job evidence is outside the verified checkpoint.");
  if (new Set(value.jobs.map(job => job.txid)).size !== value.jobs.length) throw new Error("Jobs list contains duplicate records.");
  return value;
}
export async function fetchJob(network: BitcoinNetwork, job: string, params: { fresh?: boolean; signal?: AbortSignal } = {}) {
  if (!JOB_TXID.test(job)) throw new Error("Job transaction must contain 64 lowercase hexadecimal characters.");
  const query = new URLSearchParams({ job });
  if (params.fresh) query.set("fresh", "1");
  const value = await fetchProofApiJson<JobDetail>(`/api/v1/job?${query}`, network, { signal: params.signal });
  assertJobsEvidence(value, network); assertJob(value.job);
  if (value.job.txid !== job || value.eventsComplete !== true || value.proposalsComplete !== true || value.deliveriesComplete !== true ||
    !Array.isArray(value.events) || !Array.isArray(value.proposals) || !Array.isArray(value.deliveries)) throw new Error("Complete job history is unavailable. Refresh before continuing.");
  value.events.forEach(assertEvent); value.proposals.forEach(assertEvent); value.deliveries.forEach(assertEvent);
  if (value.job.blockHeight > value.indexedThroughBlock || value.events.some(event => event.blockHeight > value.indexedThroughBlock || event.jobTxid !== job) ||
    value.proposals.some(event => event.action !== "propose" || !event.valid || !event.applied || event.jobTxid !== job) ||
    value.deliveries.some(event => event.action !== "deliver" || !event.valid || !event.applied || event.jobTxid !== job)) throw new Error("Job history differs from its verified checkpoint or lifecycle.");
  if (new Set(value.events.map(event => event.txid)).size !== value.events.length) throw new Error("Job history contains duplicate transaction evidence.");
  return value;
}
