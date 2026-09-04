import { Check, ChevronDown, Menu, X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { APP_LINKS } from "../../app/appLinks";
import { appHref, isLocalPreviewHost } from "../../app/routeRegistry";

const SHORT_LABELS: Record<string, string> = {
  AMO: "AMO",
  Browser: "Web",
  Computer: "PC",
};

function currentHref() {
  if (typeof window === "undefined") {
    return "";
  }

  return `${window.location.pathname}${window.location.search}`;
}

function linkIsActive(link: (typeof APP_LINKS)[number], current: string) {
  const localPreview = isLocalPreviewHost();

  if (localPreview && current === link.localHref) {
    return true;
  }

  if (typeof window === "undefined") {
    return false;
  }

  const resolvedHref = appHref(link.href, link.localHref);
  if (current === resolvedHref || window.location.href === resolvedHref) {
    return true;
  }

  if (window.location.href.startsWith(link.href)) {
    return true;
  }

  if (
    link.label === "AMO" &&
    (window.location.hostname === "amo.proofofwork.me" ||
      window.location.hostname === "marketplace.proofofwork.me")
  ) {
    return true;
  }

  if (localPreview) {
    const localQuery = link.localHref.split("?")[1] ?? "";
    if (!localQuery) {
      return current === link.localHref;
    }

    const currentParams = new URLSearchParams(window.location.search);
    const linkParams = new URLSearchParams(localQuery);
    for (const [key, value] of linkParams.entries()) {
      if (currentParams.get(key) !== value) {
        return false;
      }
    }

    return true;
  }

  return false;
}

type DomainNavProps = {
  onNavigate?: (label: string) => boolean | void;
};

const MOBILE_SHEET_QUERY = "(max-width: 620px)";

function enabledMenuItems(container: HTMLElement | null) {
  if (!container) {
    return [];
  }

  return Array.from(
    container.querySelectorAll<HTMLElement>(
      '[role="menuitem"]:not([disabled]), .app-menu-sheet-close:not([disabled])',
    ),
  ).filter((item) => item.getClientRects().length > 0);
}

export function DomainNav({ onNavigate }: DomainNavProps) {
  const current = currentHref();
  const [open, setOpen] = useState(false);
  const [mobileSheet, setMobileSheet] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const menuTitleId = useId();
  const activeLink =
    APP_LINKS.find((link) => linkIsActive(link, current)) ?? APP_LINKS[0];

  useEffect(() => {
    const media = window.matchMedia(MOBILE_SHEET_QUERY);
    const updateMode = () => setMobileSheet(media.matches);
    updateMode();
    media.addEventListener("change", updateMode);
    return () => media.removeEventListener("change", updateMode);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const activeItem = popoverRef.current?.querySelector<HTMLElement>(
      '[role="menuitem"][aria-current="page"]',
    );
    const firstItem = enabledMenuItems(popoverRef.current)[0];
    const focusFrame = window.requestAnimationFrame(() => {
      (activeItem ?? firstItem)?.focus();
    });

    if (mobileSheet) {
      document.documentElement.classList.add("app-menu-open");
    }

    const closeAndRestoreFocus = () => {
      setOpen(false);
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    };
    const onPointerDown = (event: PointerEvent) => {
      if (
        !mobileSheet &&
        containerRef.current &&
        !containerRef.current.contains(event.target as Node) &&
        !popoverRef.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAndRestoreFocus();
        return;
      }

      if (mobileSheet && event.key === "Tab") {
        const items = enabledMenuItems(popoverRef.current);
        if (items.length === 0) {
          event.preventDefault();
          return;
        }

        const currentIndex = items.indexOf(document.activeElement as HTMLElement);
        const nextIndex = event.shiftKey
          ? currentIndex <= 0
            ? items.length - 1
            : currentIndex - 1
          : currentIndex === -1 || currentIndex === items.length - 1
            ? 0
            : currentIndex + 1;
        event.preventDefault();
        items[nextIndex]?.focus();
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.documentElement.classList.remove("app-menu-open");
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileSheet, open]);

  function closeAndRestoreFocus() {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }

    const items = enabledMenuItems(popoverRef.current).filter(
      (item) => item.getAttribute("role") === "menuitem",
    );
    if (items.length === 0) {
      return;
    }

    const currentIndex = items.indexOf(event.target as HTMLElement);
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

  function handleNavigate(
    label: string,
    event: MouseEvent<HTMLAnchorElement>,
  ) {
    if (!onNavigate) {
      setOpen(false);
      return;
    }

    const handled = onNavigate(label);
    if (handled === true) {
      event.preventDefault();
      closeAndRestoreFocus();
      return;
    }
    setOpen(false);
  }

  const menuLayer = (
    <>
      <div
        aria-hidden="true"
        className="app-menu-scrim"
        hidden={!open || !mobileSheet}
        onPointerDown={closeAndRestoreFocus}
      />

      <div
        aria-label={mobileSheet ? undefined : "ProofOfWork.Me applications"}
        aria-labelledby={mobileSheet ? menuTitleId : undefined}
        aria-modal={mobileSheet ? true : undefined}
        className={["app-menu-popover", open ? "is-open" : ""]
          .filter(Boolean)
          .join(" ")}
        hidden={!open}
        id={menuId}
        ref={popoverRef}
        role={mobileSheet ? "dialog" : "menu"}
      >
        <div className="app-menu-sheet-head">
          <strong id={menuTitleId}>Applications</strong>
          <button
            aria-label="Close application menu"
            className="app-menu-sheet-close"
            onClick={closeAndRestoreFocus}
            type="button"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <div
          aria-label={mobileSheet ? "ProofOfWork.Me applications" : undefined}
          className="app-menu-list"
          onKeyDown={handleMenuKeyDown}
          role={mobileSheet ? "menu" : undefined}
        >
          {APP_LINKS.map((link) => {
            const active = linkIsActive(link, current);
            return (
              <a
                aria-current={active ? "page" : undefined}
                data-short={SHORT_LABELS[link.label] ?? link.label}
                href={appHref(link.href, link.localHref)}
                key={link.href}
                onClick={(event) => handleNavigate(link.label, event)}
                role="menuitem"
                title={link.label}
              >
                <span>
                  <strong>{link.label}</strong>
                  <small>{appHref(link.href, link.localHref)}</small>
                </span>
                {active ? <Check size={15} aria-hidden="true" /> : null}
              </a>
            );
          })}
        </div>
      </div>
    </>
  );

  return (
    <nav
      className={[
        "domain-nav",
        "app-menu-nav",
        open ? "is-open" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label="ProofOfWork.Me domains"
      ref={containerRef}
    >
      <div className="domain-nav-links">
        {APP_LINKS.map((link) => {
          const active = linkIsActive(link, current);
          return (
            <a
              aria-current={active ? "page" : undefined}
              href={appHref(link.href, link.localHref)}
              key={link.href}
              onClick={(event) => handleNavigate(link.label, event)}
            >
              {link.label}
            </a>
          );
        })}
      </div>

      <button
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup={mobileSheet ? "dialog" : "menu"}
        aria-label={`${open ? "Close" : "Open"} application menu`}
        className="app-menu-trigger"
        onClick={() => setOpen((value) => !value)}
        ref={triggerRef}
        type="button"
      >
        <span className="app-menu-trigger-icon" aria-hidden="true">
          <Menu size={15} />
        </span>
        <strong>{activeLink.label}</strong>
        <ChevronDown size={15} aria-hidden="true" />
      </button>

      {mobileSheet && typeof document !== "undefined"
        ? createPortal(menuLayer, document.body)
        : menuLayer}
    </nav>
  );
}
