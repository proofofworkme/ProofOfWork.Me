export const CODE_PROTOCOL_PREFIX: "pwc1:";
export const CODE_VERSION: 1;
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
export type CodeCommitMetadata = CodePutMetadata | CodeDeleteMetadata;
export type CodePayload = { kind: "repo"; metadata: CodeRepositoryMetadata } | { kind: "commit"; metadata: CodeCommitMetadata };
export type CodeSource = {
  txid: string; name: "source.txt"; mime: "text/plain"; size: number;
  sha256: string; data: string; content: string;
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
};
export type CodeRepository = {
  txid: string; repoTxid: string; name: string; description: string;
  ownerAddress: string; headTxid: string;
  blockHeight: number; blockHash: string; blockTransactionIndex: number;
  files: CodeFile[]; commits: CodeEvent[];
};
export type CodeVerificationOptions = { sha256?: (bytes: Uint8Array) => string };

export function codeSourceBytes(text: unknown): Uint8Array | null;
export function validateCodePath(path: unknown): boolean;
export function encodeCodeRepository(value: CodeRepositoryMetadata): string;
export function encodeCodeCommit(value: CodeCommitMetadata): string;
export function parseCodePayload(payload: unknown): CodePayload | null;
export function verifyCodeTransaction(transaction: unknown, options?: CodeVerificationOptions): CodeEvent | null;
export function replayCodeTransactions(transactions: unknown[], options?: CodeVerificationOptions): { repositories: CodeRepository[]; events: CodeEvent[] };
