export type ChainedMintProgressEvent =
  | { kind: "preparing"; total: number }
  | { feeSats: number; index: number; kind: "signing"; total: number }
  | { index: number; kind: "broadcast"; total: number; txid: string }
  | { kind: "complete"; txids: string[] }
  | { kind: "stopped"; reason: string };

export type ChainedMintStepArgs<TInput> = {
  currentInputs: TInput[];
  index: number;
  isLast: boolean;
  total: number;
};

export type ChainedMintStepResult<TInput, TPendingRecord> = {
  feeSats: number;
  nextInputs: TInput[];
  pendingRecord: TPendingRecord;
  txid: string;
};

export type ChainedMintRunResult<TPendingRecord> = {
  pendingRecords: TPendingRecord[];
  stopped: boolean;
  txids: string[];
};
