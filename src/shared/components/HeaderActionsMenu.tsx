import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
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
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const activeNetwork = networkOptions?.find((option) => option.active)?.label;
  const triggerLabel = activeNetwork ?? "Network";

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
        '[role="menuitem"][aria-current="true"]:not([disabled])',
      );
      const first = popoverRef.current?.querySelector<HTMLButtonElement>(
        '[role="menuitem"]:not([disabled])',
      );
      (current ?? first)?.focus();
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
      className={["header-actions-menu", open ? "is-open" : ""]
        .filter(Boolean)
        .join(" ")}
      ref={containerRef}
    >
      <button
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`${open ? "Close" : "Open"} network menu. Current network: ${triggerLabel}`}
        className="header-actions-trigger"
        disabled={busy}
        onClick={() => setOpen((value) => !value)}
        ref={triggerRef}
        type="button"
      >
        <span className="header-actions-trigger-icon" aria-hidden="true">
          <Network size={16} />
        </span>
        <strong>{triggerLabel}</strong>
        <ChevronDown size={15} aria-hidden="true" />
      </button>

      <div
        className="header-actions-popover"
        hidden={!open}
        id={menuId}
        ref={popoverRef}
        role="menu"
      >
        <div className="app-menu-list" onKeyDown={handleMenuKeyDown}>
          {networkOptions?.length ? (
            <>
              {networkOptions.map((option) => (
                <button
                  aria-current={option.active ? "true" : undefined}
                  disabled={option.disabled}
                  key={option.label}
                  onClick={() => {
                    option.onSelect();
                    closeAndRestoreFocus();
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
