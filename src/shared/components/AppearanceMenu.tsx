import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { setAppearancePreference, useAppearancePreference } from "../appearance";

const OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

export function AppearanceMenu() {
  const preference = useAppearancePreference();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const active = OPTIONS.find((option) => option.value === preference) ?? OPTIONS[2];

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => trigger.current?.focus());
  }

  useLayoutEffect(() => {
    if (!open) return;
    const positionMenu = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      const popup = menu.current?.getBoundingClientRect();
      if (!anchor || !popup) return;
      setPosition({
        left: Math.max(12, Math.min(anchor.right - popup.width, window.innerWidth - popup.width - 12)),
        top: Math.max(12, Math.min(anchor.bottom + 8, window.innerHeight - popup.height - 12)),
      });
    };
    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    });
    const outside = (event: Event) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [open]);

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
    const index = items.indexOf(event.target as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      const controls = Array.from(document.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex="0"]',
      )).filter((item) => item.tabIndex >= 0 && item.getClientRects().length > 0 && !menu.current?.contains(item));
      const triggerIndex = controls.indexOf(trigger.current as HTMLElement);
      const next = controls[triggerIndex + (event.shiftKey ? -1 : 1)] ?? trigger.current;
      event.preventDefault();
      close();
      window.requestAnimationFrame(() => next?.focus());
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
  }

  return <>
    <button
      aria-controls={open ? menuId : undefined}
      aria-expanded={open}
      aria-haspopup="menu"
      aria-label={`Appearance: ${active.label}`}
      className="topbar-action-button appearance-trigger"
      onClick={() => setOpen((value) => !value)}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setOpen(true);
        }
      }}
      ref={trigger}
      title={`Appearance: ${active.label}`}
      type="button"
    >
      <active.Icon aria-hidden="true" size={17} />
      <span>Appearance</span>
    </button>
    {open ? createPortal(<div
      aria-label="Appearance"
      className="appearance-menu"
      id={menuId}
      onKeyDown={handleMenuKeyDown}
      ref={menu}
      role="menu"
      style={position}
    >
      <div className="appearance-menu-label">Appearance</div>
      {OPTIONS.map(({ value, label, Icon }) => <button
        aria-checked={preference === value}
        key={value}
        onClick={() => { setAppearancePreference(value); close(true); }}
        role="menuitemradio"
        tabIndex={preference === value ? 0 : -1}
        type="button"
      >
        <Icon aria-hidden="true" size={17} />
        <span>{label}</span>
        {preference === value ? <Check aria-hidden="true" size={16} /> : null}
      </button>)}
    </div>, document.body) : null}
  </>;
}
