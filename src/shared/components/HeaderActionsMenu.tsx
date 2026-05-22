import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Network } from "lucide-react";

export function HeaderActionsMenu({
  busy = false,
  networkOptions,
}: {
  busy?: boolean;
  networkOptions?: Array<{
    active: boolean;
    disabled?: boolean;
    label: string;
    onSelect: () => void;
  }>;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeNetwork = networkOptions?.find((option) => option.active)?.label;
  const triggerLabel = activeNetwork ?? "Network";

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
      className={["header-actions-menu", open ? "is-open" : ""]
        .filter(Boolean)
        .join(" ")}
      ref={containerRef}
    >
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="header-actions-trigger"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="header-actions-trigger-icon" aria-hidden="true">
          <Network size={16} />
        </span>
        <strong>{triggerLabel}</strong>
        <ChevronDown size={15} aria-hidden="true" />
      </button>

      <div className="header-actions-popover" role="menu">
        <div className="app-menu-list">
          {networkOptions?.length ? (
            <>
              {networkOptions.map((option) => (
                <button
                  disabled={option.disabled}
                  key={option.label}
                  onClick={() => {
                    option.onSelect();
                    setOpen(false);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <span>
                    <strong>{option.label}</strong>
                    <small>
                      {option.active ? "Current network" : "Switch network"}
                    </small>
                  </span>
                  {option.active ? <Check size={15} /> : null}
                </button>
              ))}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
