import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  LogOut,
  Moon,
  MoreHorizontal,
  RefreshCw,
  Sun,
  Wallet,
} from "lucide-react";
import { shortAddress } from "../../functions";
import { UNISAT_DOWNLOAD_URL } from "../wallet/walletLinks";

type ThemeMode = "light" | "dark";

export function HeaderActionsMenu({
  address = "",
  busy = false,
  connectWallet,
  disconnectWallet,
  hasUnisat = true,
  onRefresh,
  networkOptions,
  setTheme,
  theme,
}: {
  address?: string;
  busy?: boolean;
  connectWallet?: () => void;
  disconnectWallet?: () => void;
  hasUnisat?: boolean;
  networkOptions?: Array<{
    active: boolean;
    disabled?: boolean;
    label: string;
    onSelect: () => void;
  }>;
  onRefresh?: () => void;
  setTheme: Dispatch<SetStateAction<ThemeMode>>;
  theme: ThemeMode;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeNetwork = networkOptions?.find((option) => option.active)?.label;
  const walletLabel = address
    ? shortAddress(address)
    : hasUnisat
      ? "Connect"
      : "Install UniSat";
  const triggerLabel = activeNetwork
    ? `${activeNetwork} · ${walletLabel}`
    : walletLabel;

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

  const toggleTheme = () => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
    setOpen(false);
  };

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
          <MoreHorizontal size={16} />
        </span>
        <strong>{triggerLabel}</strong>
        <ChevronDown size={15} aria-hidden="true" />
      </button>

      <div className="header-actions-popover" role="menu">
        <div className="app-menu-list">
          <button onClick={toggleTheme} role="menuitem" type="button">
            <span>
              <strong>
                {theme === "dark" ? "Use light mode" : "Use dark mode"}
              </strong>
              <small>Switch the interface theme</small>
            </span>
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>

          {onRefresh ? (
            <button
              disabled={busy}
              onClick={() => {
                onRefresh();
                setOpen(false);
              }}
              role="menuitem"
              type="button"
            >
              <span>
                <strong>{busy ? "Refreshing" : "Refresh"}</strong>
                <small>Reload live chain data</small>
              </span>
              <RefreshCw className={busy ? "refresh-spin" : ""} size={15} />
            </button>
          ) : null}

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

          {address ? (
            <button
              disabled={busy || !disconnectWallet}
              onClick={() => {
                disconnectWallet?.();
                setOpen(false);
              }}
              role="menuitem"
              type="button"
            >
              <span>
                <strong>{disconnectWallet ? "Disconnect wallet" : "Wallet"}</strong>
                <small>{shortAddress(address)}</small>
              </span>
              {disconnectWallet ? <LogOut size={15} /> : <Check size={15} />}
            </button>
          ) : hasUnisat ? (
            <button
              disabled={busy || !connectWallet}
              onClick={() => {
                connectWallet?.();
                setOpen(false);
              }}
              role="menuitem"
              type="button"
            >
              <span>
                <strong>Connect UniSat</strong>
                <small>Sign Bitcoin transactions locally</small>
              </span>
              <Wallet size={15} />
            </button>
          ) : (
            <a
              href={UNISAT_DOWNLOAD_URL}
              onClick={() => setOpen(false)}
              rel="noreferrer"
              role="menuitem"
              target="_blank"
            >
              <span>
                <strong>Install UniSat</strong>
                <small>Wallet required for writes</small>
              </span>
              <Wallet size={15} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
