import {
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";

export type SegmentedTabItem<T extends string> = {
  count?: ReactNode;
  description?: string;
  disabled?: boolean;
  id: T;
  label: ReactNode;
  panelId?: string;
  tabId?: string;
};

export function SegmentedTabs<T extends string>({
  ariaLabel,
  className = "",
  items,
  onChange,
  orientation = "horizontal",
  semantics = "tabs",
  value,
}: {
  ariaLabel: string;
  className?: string;
  items: Array<SegmentedTabItem<T>>;
  onChange: (value: T) => void;
  orientation?: "horizontal" | "vertical";
  semantics?: "filters" | "tabs";
  value: T;
}) {
  const idPrefix = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const navigationKeys =
      orientation === "vertical"
        ? ["ArrowDown", "ArrowUp"]
        : ["ArrowLeft", "ArrowRight"];
    if (
      event.key !== "Home" &&
      event.key !== "End" &&
      !navigationKeys.includes(event.key)
    ) {
      return;
    }

    const enabledIndices = items
      .map((item, index) => (item.disabled ? -1 : index))
      .filter((index) => index >= 0);
    if (enabledIndices.length === 0) {
      return;
    }

    const currentIndex = items.findIndex((item) => item.id === value);
    const enabledPosition = enabledIndices.indexOf(currentIndex);
    let nextPosition = 0;
    if (event.key === "End") {
      nextPosition = enabledIndices.length - 1;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextPosition =
        enabledPosition <= 0 ? enabledIndices.length - 1 : enabledPosition - 1;
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextPosition =
        enabledPosition === -1 || enabledPosition === enabledIndices.length - 1
          ? 0
          : enabledPosition + 1;
    }

    const nextIndex = enabledIndices[nextPosition];
    const nextItem = items[nextIndex];
    if (!nextItem) {
      return;
    }

    event.preventDefault();
    onChange(nextItem.id);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <div
      aria-label={ariaLabel}
      aria-orientation={semantics === "tabs" ? orientation : undefined}
      className={["proof-segmented-tabs", className].filter(Boolean).join(" ")}
      role={semantics === "tabs" ? "tablist" : "group"}
    >
      {items.map((item, index) => {
        const selected = item.id === value;
        return (
          <button
            aria-controls={semantics === "tabs" ? item.panelId : undefined}
            aria-pressed={semantics === "filters" ? selected : undefined}
            aria-selected={semantics === "tabs" ? selected : undefined}
            className="proof-segmented-tab"
            disabled={item.disabled}
            id={item.tabId ?? `${idPrefix}-${item.id}`}
            key={item.id}
            onClick={() => onChange(item.id)}
            onKeyDown={handleKeyDown}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            role={semantics === "tabs" ? "tab" : undefined}
            tabIndex={semantics === "tabs" ? (selected ? 0 : -1) : undefined}
            title={item.description}
            type="button"
          >
            <span className="proof-segmented-tab-label">{item.label}</span>
            {item.count === undefined ? null : (
              <span className="proof-segmented-tab-count">{item.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
