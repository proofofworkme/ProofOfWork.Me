import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
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
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  function closeAndRestoreFocus() {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    const focusFrame = window.requestAnimationFrame(() => {
      const current = popoverRef.current?.querySelector<HTMLButtonElement>(
        '[role="menuitem"]:not([disabled])',
      );
      current?.focus();
    });
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
        closeAndRestoreFocus();
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }

    const items = Array.from(
      popoverRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not([disabled])',
      ) ?? [],
    );
    if (items.length === 0) {
      return;
    }

    const currentIndex = items.indexOf(event.target as HTMLButtonElement);
    let nextIndex = 0;
    if (event.key === "End") {
      nextIndex = items.length - 1;
    } else if (event.key === "ArrowUp") {
      nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
    } else if (event.key === "ArrowDown") {
      nextIndex =
        currentIndex === -1 || currentIndex === items.length - 1
          ? 0
          : currentIndex + 1;
    }
    event.preventDefault();
    items[nextIndex]?.focus();
  }

  return (
    <div
      className={["network-select-menu", open ? "is-open" : ""]
        .filter(Boolean)
        .join(" ")}
      ref={containerRef}
    >
      <button
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Select ProofOfWork network"
        className="network-select-trigger"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        ref={triggerRef}
        type="button"
      >
        <Network size={15} aria-hidden="true" />
        <strong>{NETWORK_LABELS[network]}</strong>
        <ChevronDown size={13} aria-hidden="true" />
      </button>

      <div
        className="network-select-popover"
        hidden={!open}
        id={menuId}
        onKeyDown={handleMenuKeyDown}
        ref={popoverRef}
        role="menu"
      >
        {NETWORK_OPTIONS.map((option) => (
          <button
            aria-current={network === option.network}
            disabled={disabled || network === option.network}
            key={option.network}
            onClick={() => {
              onChange(option.network);
              closeAndRestoreFocus();
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
