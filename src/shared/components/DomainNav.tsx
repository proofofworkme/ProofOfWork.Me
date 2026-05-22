import { Check, ChevronDown, Menu } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { APP_LINKS } from "../../app/appLinks";
import { appHref } from "../../app/routeRegistry";

const SHORT_LABELS: Record<string, string> = {
  Browser: "Web",
  Computer: "PC",
  Marketplace: "Market",
};

function currentHref() {
  if (typeof window === "undefined") {
    return "";
  }

  return `${window.location.pathname}${window.location.search}`;
}

function linkIsActive(link: (typeof APP_LINKS)[number], current: string) {
  if (current === link.localHref) {
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

type DomainNavProps = {
  onNavigate?: (label: string) => boolean | void;
};

export function DomainNav({ onNavigate }: DomainNavProps) {
  const current = currentHref();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeLink =
    APP_LINKS.find((link) => linkIsActive(link, current)) ?? APP_LINKS[0];

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
    }
    setOpen(false);
  }

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
        aria-expanded={open}
        aria-haspopup="menu"
        className="app-menu-trigger"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="app-menu-trigger-icon" aria-hidden="true">
          <Menu size={15} />
        </span>
        <strong>{activeLink.label}</strong>
        <ChevronDown size={15} aria-hidden="true" />
      </button>

      <div className="app-menu-popover" role="menu">
        <div className="app-menu-list">
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
    </nav>
  );
}
