export type JobRecordAction = 'brief' | 'propose' | 'assign' | 'deliver' | 'accept' | 'cancel';
export const JOBS_BODY_PREFIX: string;
export const JOBS_VERSION: number;
export const JOBS_ACTIVATION_HEIGHT: number;
export const JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH: string;
export const JOBS_MAX_METADATA_BYTES: number;
export const JOBS_ACTIONS: readonly JobRecordAction[];
export function encodeJobRecord(action: JobRecordAction, value: Record<string, unknown>): string;
export function parseJobBody(body: string): { action: JobRecordAction; metadata: Record<string, unknown> } | null;
