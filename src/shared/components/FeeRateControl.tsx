import { ReactNode } from "react";

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
          Fee proof/vB
          <input
            min={0.1}
            onChange={(event) => setFeeRate(Number(event.target.value))}
            step={0.1}
            type="number"
            value={feeRate}
          />
        </label>
        {sidecar}
      </div>
      <div className="fee-presets" aria-label="Fee presets">
        {[1, 2, 5, 10].map((preset) => (
          <button
            aria-pressed={feeRate === preset}
            key={preset}
            onClick={() => setFeeRate(preset)}
            type="button"
          >
            {preset}
          </button>
        ))}
      </div>
    </div>
  );
}
