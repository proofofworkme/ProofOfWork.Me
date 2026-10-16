export const CODE_PROTOCOL_PREFIX: "pwc1:";
export const CODE_VERSION: 1;
export const CODE_REFERENCE_VERSION: 2;
export const CODE_REFERENCE_NETWORK: "livenet";
export const CODE_REFERENCE_ACTIVATION_HEIGHT: 971652;
export const CODE_REFERENCE_ACTIVATION_PARENT_HEIGHT: 971651;
export const CODE_REFERENCE_ACTIVATION_PARENT_HASH: "0000000000000000000057f291a6c81728bbdeb52c0db842115ab6d009db870f";
export const CODE_MAX_SOURCE_BYTES: 60000;
export const CODE_MAX_DATA_CARRIER_BYTES: 100000;
export const CODE_MAX_NAME_BYTES: 200;
export const CODE_MAX_DESCRIPTION_BYTES: 1000;
export const CODE_MAX_MESSAGE_BYTES: 500;
export const CODE_MAX_PATH_BYTES: 1024;
export const CODE_MAX_METADATA_BYTES: 4096;
export const CODE_SOURCE_NAME: "source.txt";
export const CODE_SOURCE_MIME: "text/plain";
export const CODE_EMPTY_SHA256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export type CodeRepositoryMetadata = { v: 1; name: string; description: string };
export type CodePutMetadata = {
  v: 1; repo: string; parent: string; op: "put"; path: string; message: string;
  sha256: string; size: number;
};
export type CodeDeleteMetadata = { v: 1; repo: string; parent: string; op: "delete"; path: string; message: string };
export type CodeReferenceMetadata = {
  v: 2; repo: string; parent: string; op: "reference"; path: string; message: string;
  sourceTxid: string; sourceKind: "body" | "attachment"; sourceVout: number; sha256: string; size: number;
};
export type CodeCommitMetadata = CodePutMetadata | CodeDeleteMetadata | CodeReferenceMetadata;
export type CodePayload = { kind: "repo"; metadata: CodeRepositoryMetadata } |
  { kind: "commit"; metadata: CodePutMetadata | CodeDeleteMetadata } | { kind: "commit2"; metadata: CodeReferenceMetadata };
export type CodeSource = {
  txid: string; name: "source.txt"; mime: "text/plain"; size: number;
  sha256: string; data: string; content: string;
  sourceTxid?: string; sourceKind?: "body" | "attachment"; sourceVout?: number;
};
export type CodePageSource = {
  kind: "body" | "attachment"; vout: number; name: string; sha256: string;
  size: number; data: string; content: string;
};
export type CodeFile = CodeSource & { path: string };
export type CodeEvent = {
  txid: string; protocol: "pwc1"; kind: "code-repository" | "code-commit";
  ownerAddress: string; repoTxid: string; parentTxid: string; path: string; message: string;
  metadata: CodeRepositoryMetadata | CodeCommitMetadata | null;
  status: "confirmed" | "pending" | "dropped" | "orphaned" | "unknown"; confirmed: boolean;
  blockHeight: number | null; blockHash: string; blockTransactionIndex: number | null; blockIndex: number | null;
  protocolVout: number; recordOrdinal: 0; amountSats: string; carrierBytes: number;
  rawPayload: string; rawPayloadHex: string;
  valid: boolean; validationErrors: string[]; applied: boolean; source?: CodeSource;
  sourceVerification?: "deferred" | "verified" | "invalid";
};
export type CodeRepository = {
  txid: string; repoTxid: string; name: string; description: string;
  ownerAddress: string; headTxid: string;
  blockHeight: number; blockHash: string; blockTransactionIndex: number;
  files: CodeFile[]; commits: CodeEvent[];
};
export type CodeVerificationOptions = {
  sha256?: (bytes: Uint8Array) => string;
  network?: string;
  referencePolicy?: { network: string; activationHeight: number };
  referenceSources?: Map<string, unknown>;
  checkpointHeight?: number;
  checkpointHash?: string;
  /** Only envelope observation; reference source and repository authority remain unresolved. */
  structuralOnly?: boolean;
};

export function codeSourceBytes(text: unknown): Uint8Array | null;
export function validateCodePath(path: unknown): boolean;
export function encodeCodeRepository(value: CodeRepositoryMetadata): string;
export function encodeCodeCommit(value: CodePutMetadata | CodeDeleteMetadata): string;
export function encodeCodeReferenceCommit(value: CodeReferenceMetadata): string;
export function enumerateCodePageSources(transaction: unknown, options?: CodeVerificationOptions): CodePageSource[];
export function parseCodePayload(payload: unknown): CodePayload | null;
export function verifyCodeTransaction(transaction: unknown, options?: CodeVerificationOptions): CodeEvent | null;
export function replayCodeTransactions(transactions: unknown[], options?: CodeVerificationOptions): { repositories: CodeRepository[]; events: CodeEvent[] };
