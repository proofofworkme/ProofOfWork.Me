import { ReactNode } from "react";
import { FEE_RATE_STEP } from "../feeRate";

export const FEE_RATE_PRESETS = [0.1, 0.5, 1, 2] as const;

export function FeeRateControl({
  feeRate,
  setFeeRate,
  sidecar,
  label = "Fee proofs/vB",
  presetsLabel = "Fee presets",
  disabled = false,
  inputValue,
  setInputValue,
}: {
  feeRate: number;
  setFeeRate: (value: number) => void;
  sidecar?: ReactNode;
  label?: string;
  presetsLabel?: string;
  disabled?: boolean;
  inputValue?: string;
  setInputValue?: (value: string) => void;
}) {
  return (
    <div className="fee-control">
      <div className={sidecar ? "fee-control-grid" : undefined}>
        <label>
          {label}
          <input
            min={0.1}
            disabled={disabled}
            inputMode="decimal"
            onChange={(event) => setInputValue ? setInputValue(event.target.value) : setFeeRate(Number(event.target.value))}
            step={FEE_RATE_STEP}
            type={inputValue === undefined ? "number" : "text"}
            value={inputValue ?? feeRate}
          />
        </label>
        {sidecar}
      </div>
      <div className="fee-presets" aria-label={presetsLabel}>
        {FEE_RATE_PRESETS.map((preset) => (
          <button
            aria-pressed={inputValue === undefined ? Math.abs(feeRate - preset) < 0.00000001 : feeRate === preset}
            disabled={disabled}
            key={preset}
            onClick={() => setInputValue ? setInputValue(String(preset)) : setFeeRate(preset)}
            type="button"
          >
            {preset} proofs/vB
          </button>
        ))}
      </div>
    </div>
  );
}
