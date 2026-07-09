import { LogOut, RefreshCw, Wallet } from "lucide-react";
import { HOME_APP_URL, LOCAL_HOME_APP_URL } from "../../app/appLinks";
import { appHref } from "../../app/routeRegistry";
import { shortAddress } from "../../functions";
import type { BitcoinNetwork } from "../bitcoin/networks";
import { UNISAT_DOWNLOAD_URL } from "../wallet/walletLinks";
import { DomainNav } from "./DomainNav";
import { HeaderActionsMenu } from "./HeaderActionsMenu";

export type AppHeaderAccountStat = {
  detail?: string;
  label: string;
  tone?: "default" | "pending" | "strong";
  value: string;
};

export function AppHeader({
  accountStats = [],
  address = "",
  busy = false,
  connectWallet,
  disconnectWallet,
  hasUnisat = true,
  homeHref = appHref(HOME_APP_URL, LOCAL_HOME_APP_URL),
  network,
  onDomainNavigate,
  onNetworkChange,
  onRefresh,
  subtitle,
  title,
}: {
  accountStats?: AppHeaderAccountStat[];
  address?: string;
  busy?: boolean;
  connectWallet?: () => void;
  disconnectWallet?: () => void;
  hasUnisat?: boolean;
  homeHref?: string;
  network?: BitcoinNetwork;
  onDomainNavigate?: (label: string) => boolean | void;
  onNetworkChange?: (network: BitcoinNetwork) => void;
  onRefresh?: () => void;
  subtitle?: string;
  title: string;
}) {
  const visibleAccountStats = accountStats.filter(
    (stat) => stat.label.trim() && stat.value.trim(),
  );
  const networkOptions = network && onNetworkChange
    ? [
        {
          active: network === "testnet4",
          label: "Testnet4",
          network: "testnet4" as const,
        },
        {
          active: network === "testnet",
          label: "Testnet3",
          network: "testnet" as const,
        },
        {
          active: network === "livenet",
          label: "Mainnet",
          network: "livenet" as const,
        },
      ]
    : [];
  const refreshAction =
    onRefresh ??
    (() => {
      if (typeof window !== "undefined") window.location.reload();
    });

  return (
    <div
      className={
        visibleAccountStats.length
          ? "app-header-stack has-account-stats"
          : "app-header-stack"
      }
    >
      <header className="topbar">
        <a
          className="brand"
          href={homeHref}
          aria-label="ProofOfWork.Me home"
        >
          <div className="brand-mark" aria-hidden="true">
            PoW
          </div>
          <div>
            <h1>{title}</h1>
            {subtitle ? <span>{subtitle}</span> : null}
          </div>
        </a>

        <DomainNav onNavigate={onDomainNavigate} />

        <div className="topbar-actions">
          {onRefresh ? (
            <button
              aria-label={busy ? "Refreshing" : "Refresh"}
              className="topbar-action-button topbar-refresh-button"
              disabled={busy}
              onClick={() => void refreshAction()}
              title={busy ? "Refreshing" : "Refresh"}
              type="button"
            >
              <RefreshCw className={busy ? "refresh-spin" : ""} size={15} />
              <span>{busy ? "Refreshing" : "Refresh"}</span>
            </button>
          ) : null}

          {networkOptions.length ? (
            <HeaderActionsMenu
              busy={busy}
              networkOptions={networkOptions.map((option) => ({
                active: option.active,
                disabled: busy,
                label: option.label,
                onSelect: () => onNetworkChange?.(option.network),
              }))}
            />
          ) : null}

          {address ? (
            <button
              aria-label="Disconnect UniSat"
              className="topbar-action-button topbar-wallet-button"
              disabled={busy || !disconnectWallet}
              onClick={() => void disconnectWallet?.()}
              title="Disconnect UniSat"
              type="button"
            >
              <LogOut size={15} />
              <span>{shortAddress(address)}</span>
            </button>
          ) : hasUnisat && connectWallet ? (
            <button
              aria-label="Connect UniSat"
              className="topbar-action-button topbar-wallet-button"
              disabled={busy}
              onClick={() => void connectWallet()}
              type="button"
            >
              <Wallet size={15} />
              <span>Connect UniSat</span>
            </button>
          ) : !hasUnisat ? (
            <a
              aria-label="Install UniSat"
              className="topbar-action-button topbar-wallet-button"
              href={UNISAT_DOWNLOAD_URL}
              rel="noreferrer"
              target="_blank"
            >
              <Wallet size={15} />
              <span>Install UniSat</span>
            </a>
          ) : null}
        </div>
      </header>

      {visibleAccountStats.length ? (
        <div
          aria-label="Connected account summary"
          className="account-signal-bar"
          role="list"
        >
          {visibleAccountStats.map((stat) => (
            <div
              className={
                stat.tone && stat.tone !== "default"
                  ? `account-signal-item is-${stat.tone}`
                  : "account-signal-item"
              }
              key={`${stat.label}-${stat.value}`}
              role="listitem"
              title={stat.detail}
            >
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
