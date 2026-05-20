import type {
  ChainedMintProgressEvent,
  ChainedMintRunResult,
  ChainedMintStepArgs,
  ChainedMintStepResult,
} from "./types";

function waitForDelay(ms: number, isActive: () => boolean) {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const startedAt = Date.now();
    const tick = () => {
      if (!isActive() || Date.now() - startedAt >= ms) {
        resolve();
        return;
      }

      window.setTimeout(tick, Math.min(250, ms));
    };

    tick();
  });
}

export async function executeChainedMintRun<TInput, TPendingRecord>({
  buildAndBroadcastStep,
  count,
  delayMs = 0,
  initialInputs,
  isActive = () => true,
  onProgress,
}: {
  buildAndBroadcastStep: (
    args: ChainedMintStepArgs<TInput>,
  ) => Promise<ChainedMintStepResult<TInput, TPendingRecord>>;
  count: number;
  delayMs?: number;
  initialInputs: TInput[];
  isActive?: () => boolean;
  onProgress?: (event: ChainedMintProgressEvent) => void;
}): Promise<ChainedMintRunResult<TPendingRecord>> {
  const total = Math.max(0, Math.floor(count));
  const txids: string[] = [];
  const pendingRecords: TPendingRecord[] = [];
  let currentInputs = initialInputs;

  onProgress?.({ kind: "preparing", total });

  for (let index = 0; index < total; index += 1) {
    if (!isActive()) {
      onProgress?.({ kind: "stopped", reason: "canceled" });
      return { pendingRecords, stopped: true, txids };
    }

    const result = await buildAndBroadcastStep({
      currentInputs,
      index,
      isLast: index === total - 1,
      total,
    });

    txids.push(result.txid);
    pendingRecords.push(result.pendingRecord);
    currentInputs = result.nextInputs;
    onProgress?.({
      index,
      kind: "broadcast",
      total,
      txid: result.txid,
    });

    if (index < total - 1) {
      await waitForDelay(delayMs, isActive);
    }
  }

  onProgress?.({ kind: "complete", txids });
  return { pendingRecords, stopped: false, txids };
}
