import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Network } from "lucide-react";
import type { BitcoinNetwork } from "../bitcoin/networks";

const NETWORK_LABELS: Record<BitcoinNetwork, string> = {
  livenet: "Main",
  testnet: "Test3",
  testnet4: "Test4",
};

const NETWORK_OPTIONS: Array<{ label: string; network: BitcoinNetwork }> = [
  { label: "Mainnet", network: "livenet" },
  { label: "Testnet4", network: "testnet4" },
  { label: "Testnet3", network: "testnet" },
];

export function NetworkSelectMenu({
  disabled = false,
  network,
  onChange,
}: {
  disabled?: boolean;
  network: BitcoinNetwork;
  onChange: (network: BitcoinNetwork) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div
      className={["network-select-menu", open ? "is-open" : ""]
        .filter(Boolean)
        .join(" ")}
      ref={containerRef}
    >
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Select ProofOfWork network"
        className="network-select-trigger"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <Network size={15} aria-hidden="true" />
        <strong>{NETWORK_LABELS[network]}</strong>
        <ChevronDown size={13} aria-hidden="true" />
      </button>

      <div className="network-select-popover" role="menu">
        {NETWORK_OPTIONS.map((option) => (
          <button
            aria-current={network === option.network}
            disabled={disabled || network === option.network}
            key={option.network}
            onClick={() => {
              onChange(option.network);
              setOpen(false);
            }}
            role="menuitem"
            type="button"
          >
            <span>
              <strong>{option.label}</strong>
              <small>
                {network === option.network
                  ? "Current network"
                  : "Switch network"}
              </small>
            </span>
            {network === option.network ? <Check size={15} /> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
