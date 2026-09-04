import { Check, Copy } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export function MetricValue({
  className = "",
  copyLabel = "Copy exact value",
  displayValue,
  exactValue,
  label,
  showExact = true,
  unit,
}: {
  className?: string;
  copyLabel?: string;
  displayValue?: ReactNode;
  exactValue: string;
  label?: string;
  showExact?: boolean;
  unit?: string;
}) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number>();
  const readableValue = `${exactValue}${unit ? ` ${unit}` : ""}`;

  useEffect(
    () => () => {
      if (resetTimer.current !== undefined) {
        window.clearTimeout(resetTimer.current);
      }
    },
    [],
  );

  async function copyExactValue() {
    try {
      await navigator.clipboard.writeText(readableValue);
      setCopied(true);
      if (resetTimer.current !== undefined) {
        window.clearTimeout(resetTimer.current);
      }
      resetTimer.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={["proof-metric-value", className].filter(Boolean).join(" ")}>
      <data
        aria-label={label ? `${label}: ${readableValue}` : readableValue}
        className="proof-metric-display"
        title={readableValue}
        value={exactValue}
      >
        <span>{displayValue ?? exactValue}</span>
        {unit ? <small>{unit}</small> : null}
      </data>

      {showExact ? (
        <details className="proof-metric-exact">
          <summary>Exact value</summary>
          <div>
            <code>{readableValue}</code>
            <button
              aria-label={copyLabel}
              className="proof-metric-copy"
              onClick={() => void copyExactValue()}
              type="button"
            >
              {copied ? (
                <Check aria-hidden="true" size={15} />
              ) : (
                <Copy aria-hidden="true" size={15} />
              )}
              <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
            </button>
          </div>
        </details>
      ) : null}
    </div>
  );
}
