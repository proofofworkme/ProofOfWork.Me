import { Check, ChevronDown, ChevronUp, Menu, X } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { APP_LINKS, APP_MENU_GROUPS, type AppLink } from "../../app/appLinks";
import { appHref, isLocalPreviewHost } from "../../app/routeRegistry";

function currentHref() {
  return typeof window === "undefined"
    ? ""
    : `${window.location.pathname}${window.location.search}`;
}

function linkIsActive(link: AppLink, current: string) {
  if (typeof window === "undefined") return false;
  const localPreview = isLocalPreviewHost();
  if (localPreview && current === link.localHref) return true;
  const resolvedHref = appHref(link.href, link.localHref);
  if (current === resolvedHref || window.location.href === resolvedHref) return true;
  if (window.location.href.startsWith(link.href)) return true;
  if (
    link.label === "AMO" &&
    ["amo.proofofwork.me", "marketplace.proofofwork.me"].includes(window.location.hostname)
  ) return true;
  if (localPreview) {
    const localQuery = link.localHref.split("?")[1] ?? "";
    if (!localQuery) return current === link.localHref;
    const currentParams = new URLSearchParams(window.location.search);
    for (const [key, value] of new URLSearchParams(localQuery).entries()) {
      if (currentParams.get(key) !== value) return false;
    }
    return true;
  }
  return false;
}

const MOBILE_SHEET_QUERY = "(max-width: 620px)";
const COMPACT_HEADER_QUERY = "(max-width: 900px)";

type DomainNavProps = {
  onNavigate?: (label: string) => boolean | void;
  placement?: "header" | "footer";
};

function enabledMenuItems(container: HTMLElement | null) {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(
    '[role="menuitem"]:not([disabled]), .app-menu-sheet-close:not([disabled])',
  )).filter((item) => item.getClientRects().length > 0);
}

export function DomainNav({ onNavigate, placement = "header" }: DomainNavProps) {
  const current = currentHref();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [mobileSheet, setMobileSheet] = useState(false);
  const [compactHeader, setCompactHeader] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  const containerRef = useRef<HTMLElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const focusEndRef = useRef(false);
  const menuId = useId();
  const menuTitleId = useId();
  const open = openGroup !== null;
  const activeLink = APP_LINKS.find((link) => linkIsActive(link, current)) ?? APP_LINKS[0];
  const visibleGroups = openGroup === "all"
    ? APP_MENU_GROUPS
    : APP_MENU_GROUPS.filter((group) => group.label === openGroup);
  const menuTitle = openGroup === "all" ? "Applications" : openGroup ?? "Applications";

  function closeAndRestoreFocus() {
    setOpenGroup(null);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  useEffect(() => {
    const sheetMedia = window.matchMedia(MOBILE_SHEET_QUERY);
    const compactMedia = window.matchMedia(COMPACT_HEADER_QUERY);
    const updateMode = () => {
      const restoreFocus = popoverRef.current?.contains(document.activeElement);
      setMobileSheet(sheetMedia.matches);
      setCompactHeader(compactMedia.matches);
      setOpenGroup(null);
      if (restoreFocus) {
        window.requestAnimationFrame(() => {
          const nextTrigger = placement === "header"
            ? containerRef.current?.querySelector<HTMLButtonElement>(compactMedia.matches
              ? ".app-menu-trigger"
              : ".domain-menu-trigger.has-current-app, .domain-menu-trigger")
            : triggerRef.current;
          nextTrigger?.focus();
        });
      }
    };
    updateMode();
    sheetMedia.addEventListener("change", updateMode);
    compactMedia.addEventListener("change", updateMode);
    return () => {
      sheetMedia.removeEventListener("change", updateMode);
      compactMedia.removeEventListener("change", updateMode);
    };
  }, []);

  useLayoutEffect(() => {
    if (!open || mobileSheet) return;
    const updatePosition = () => {
      if (!triggerRef.current || !popoverRef.current) return;
      const anchor = triggerRef.current.getBoundingClientRect();
      const popup = popoverRef.current.getBoundingClientRect();
      const left = Math.max(12, Math.min(anchor.right - popup.width, window.innerWidth - popup.width - 12));
      const preferredTop = placement === "footer"
        ? anchor.top - popup.height - 8
        : anchor.bottom + 8;
      const top = Math.max(12, Math.min(preferredTop, window.innerHeight - popup.height - 12));
      setPosition({ left, top });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [mobileSheet, open, openGroup, placement]);

  useEffect(() => {
    if (!open) return;
    const activeItem = popoverRef.current?.querySelector<HTMLElement>(
      '[role="menuitem"][aria-current="page"]',
    );
    const items = enabledMenuItems(popoverRef.current).filter(
      (item) => item.getAttribute("role") === "menuitem",
    );
    const focusFrame = window.requestAnimationFrame(() => {
      (focusEndRef.current ? items[items.length - 1] : activeItem ?? items[0])?.focus();
      focusEndRef.current = false;
    });
    if (mobileSheet) document.documentElement.classList.add("app-menu-open");
    const onPointerDown = (event: PointerEvent) => {
      if (
        !mobileSheet &&
        !containerRef.current?.contains(event.target as Node) &&
        !popoverRef.current?.contains(event.target as Node)
      ) setOpenGroup(null);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (
        !mobileSheet &&
        !containerRef.current?.contains(event.target as Node) &&
        !popoverRef.current?.contains(event.target as Node)
      ) setOpenGroup(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAndRestoreFocus();
      } else if (mobileSheet && event.key === "Tab") {
        const items = enabledMenuItems(popoverRef.current);
        event.preventDefault();
        const currentIndex = items.indexOf(document.activeElement as HTMLElement);
        const nextIndex = event.shiftKey
          ? currentIndex <= 0 ? items.length - 1 : currentIndex - 1
          : currentIndex === -1 || currentIndex === items.length - 1 ? 0 : currentIndex + 1;
        items[nextIndex]?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      if (mobileSheet) document.documentElement.classList.remove("app-menu-open");
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileSheet, open, openGroup]);

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab" && !mobileSheet) {
      const controls = Array.from(document.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex="0"]',
      )).filter((item) => item.tabIndex >= 0 && item.getClientRects().length > 0 && !popoverRef.current?.contains(item));
      const index = controls.indexOf(triggerRef.current as HTMLElement);
      const next = controls[index + (event.shiftKey ? -1 : 1)];
      event.preventDefault();
      setOpenGroup(null);
      window.requestAnimationFrame(() => (next ?? triggerRef.current)?.focus());
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = enabledMenuItems(popoverRef.current).filter(
      (item) => item.getAttribute("role") === "menuitem",
    );
    if (!items.length) return;
    const currentIndex = items.indexOf(event.target as HTMLElement);
    let nextIndex = 0;
    if (event.key === "End") nextIndex = items.length - 1;
    else if (event.key === "ArrowUp") nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
    else if (event.key === "ArrowDown") nextIndex = currentIndex === -1 || currentIndex === items.length - 1 ? 0 : currentIndex + 1;
    event.preventDefault();
    items[nextIndex]?.focus();
  }

  function toggleGroup(group: string, button: HTMLButtonElement) {
    triggerRef.current = button;
    setOpenGroup((value) => value === group ? null : group);
  }

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, group: string) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    triggerRef.current = event.currentTarget;
    focusEndRef.current = event.key === "ArrowUp";
    if (openGroup === group) {
      const items = enabledMenuItems(popoverRef.current).filter((item) => item.getAttribute("role") === "menuitem");
      (focusEndRef.current ? items[items.length - 1] : items[0])?.focus();
      focusEndRef.current = false;
    } else setOpenGroup(group);
  }

  function handleNavigate(label: string, event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
      setOpenGroup(null);
      return;
    }
    if (onNavigate?.(label) === true) {
      event.preventDefault();
      closeAndRestoreFocus();
      return;
    }
    setOpenGroup(null);
  }

  const menuLayer = (
    <>
      <div aria-hidden="true" className="app-menu-scrim" hidden={!open || !mobileSheet} onPointerDown={closeAndRestoreFocus} />
      <div
        aria-label={mobileSheet ? undefined : `${menuTitle} products`}
        aria-labelledby={mobileSheet ? menuTitleId : undefined}
        aria-modal={mobileSheet ? true : undefined}
        className={`app-menu-popover grouped-domain-popover${open ? " is-open" : ""}${mobileSheet ? " is-mobile-sheet" : ""}`}
        hidden={!open}
        id={menuId}
        ref={popoverRef}
        role={mobileSheet ? "dialog" : "menu"}
        style={mobileSheet ? undefined : position}
      >
        <div className="app-menu-sheet-head">
          <strong id={menuTitleId}>{menuTitle}</strong>
          <button aria-label="Close application menu" className="app-menu-sheet-close" onClick={closeAndRestoreFocus} type="button"><X aria-hidden="true" size={18} /></button>
        </div>
        <div aria-label={mobileSheet ? `${menuTitle} products` : undefined} className="app-menu-list grouped-domain-list" onKeyDown={handleMenuKeyDown} role={mobileSheet ? "menu" : undefined}>
          {visibleGroups.map((group) => (
            <div className="domain-menu-group" role="group" aria-labelledby={`${menuId}-${group.label}`} key={group.label}>
              <strong className="domain-menu-group-label" id={`${menuId}-${group.label}`}>{group.label}</strong>
              <div className="domain-menu-products">
                {group.links.map((link) => {
                  const active = linkIsActive(link, current);
                  return (
                    <a aria-current={active ? "page" : undefined} href={appHref(link.href, link.localHref)} key={link.href} onClick={(event) => handleNavigate(link.label, event)} role="menuitem">
                      <span><strong>{link.displayLabel}</strong><small>{link.description}</small></span>
                      {active ? <Check size={15} aria-hidden="true" /> : null}
                    </a>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );

  return (
    <nav className={`domain-nav app-menu-nav grouped-domain-nav${placement === "footer" ? " domain-nav-footer" : ""}${open ? " is-open" : ""}`} aria-label={`ProofOfWork.Me ${placement} product menus`} ref={containerRef}>
      <div className="domain-nav-links domain-nav-groups">
        {APP_MENU_GROUPS.map((group) => (
          <button
            aria-controls={menuId}
            aria-expanded={openGroup === group.label}
            aria-haspopup={mobileSheet ? "dialog" : "menu"}
            className={`domain-menu-trigger${group.links.some((link) => linkIsActive(link, current)) ? " has-current-app" : ""}`}
            key={group.label}
            onClick={(event) => toggleGroup(group.label, event.currentTarget)}
            onKeyDown={(event) => handleTriggerKeyDown(event, group.label)}
            type="button"
          >
            {group.label}{placement === "footer" ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
          </button>
        ))}
      </div>
      {placement === "header" ? (
        <button aria-controls={menuId} aria-expanded={openGroup === "all"} aria-haspopup={mobileSheet ? "dialog" : "menu"} aria-label={`${open ? "Close" : "Open"} application menu`} className="app-menu-trigger" onClick={(event) => toggleGroup("all", event.currentTarget)} onKeyDown={(event) => handleTriggerKeyDown(event, "all")} type="button">
          <span className="app-menu-trigger-icon" aria-hidden="true"><Menu size={15} /></span>
          <strong>{activeLink.label === "Home" ? "Menus" : activeLink.label === "IDs" ? "ID" : activeLink.label}</strong>
          <ChevronDown size={15} aria-hidden="true" />
        </button>
      ) : null}
      {typeof document !== "undefined" && (open || mobileSheet || compactHeader) ? createPortal(menuLayer, document.body) : null}
    </nav>
  );
}
