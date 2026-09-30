import { ReactNode } from "react";
import { FEE_RATE_STEP } from "../feeRate";

export const FEE_RATE_PRESETS = [0.1, 0.5, 1, 2] as const;

export function FeeRateControl({
  feeRate,
  setFeeRate,
  sidecar,
}: {
  feeRate: number;
  setFeeRate: (value: number) => void;
  sidecar?: ReactNode;
}) {
  return (
    <div className="fee-control">
      <div className={sidecar ? "fee-control-grid" : undefined}>
        <label>
          Fee proofs/vB
          <input
            min={0.1}
            onChange={(event) => setFeeRate(Number(event.target.value))}
            step={FEE_RATE_STEP}
            type="number"
            value={feeRate}
          />
        </label>
        {sidecar}
      </div>
      <div className="fee-presets" aria-label="Fee presets">
        {FEE_RATE_PRESETS.map((preset) => (
          <button
            aria-pressed={Math.abs(feeRate - preset) < 0.00000001}
            key={preset}
            onClick={() => setFeeRate(preset)}
            type="button"
          >
            {preset} proofs/vB
          </button>
        ))}
      </div>
    </div>
  );
}
