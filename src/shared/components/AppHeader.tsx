import { ChevronDown, LogOut, RefreshCw, Wallet } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { HOME_APP_URL, LOCAL_HOME_APP_URL } from "../../app/appLinks";
import { appHref } from "../../app/routeRegistry";
import { shortAddress } from "../../functions";
import type { BitcoinNetwork } from "../bitcoin/networks";
import { isMobileWalletBrowser, UNISAT_DOWNLOAD_URL } from "../wallet/walletLinks";
import { UnisatMobileHandoff } from "./UnisatMobileHandoff";
import { DomainNav } from "./DomainNav";
import { BrandMark } from "./BrandMark";
import { HeaderActionsMenu } from "./HeaderActionsMenu";
import { AppearanceMenu } from "./AppearanceMenu";

export type AppHeaderAccountStat = {
  detail?: string;
  label: string;
  tone?: "default" | "pending" | "strong";
  value: string;
};

export function AppHeader({
  afterHeader,
  accountStats = [],
  address = "",
  busy = false,
  connectWallet,
  disconnectWallet,
  hasUnisat = true,
  homeHref = appHref(HOME_APP_URL, LOCAL_HOME_APP_URL),
  network,
  navigationControls,
  onDomainNavigate,
  onNetworkChange,
  onRefresh,
  onRefreshRecovery,
  subtitle,
  title,
  titleAs = "h1",
}: {
  afterHeader?: ReactNode;
  accountStats?: AppHeaderAccountStat[];
  address?: string;
  busy?: boolean;
  connectWallet?: () => void;
  disconnectWallet?: () => void;
  hasUnisat?: boolean;
  homeHref?: string;
  network?: BitcoinNetwork;
  navigationControls?: ReactNode;
  onDomainNavigate?: (label: string) => boolean | void;
  onNetworkChange?: (network: BitcoinNetwork) => void;
  onRefresh?: () => void;
  onRefreshRecovery?: () => void;
  subtitle?: string;
  title: string;
  titleAs?: "h1" | "span";
}) {
  const Title = titleAs;
  const [expandedStatLabel, setExpandedStatLabel] = useState<string>();
  const accountDetailId = useId();
  const headerStackRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const header = headerStackRef.current;
    const parent = header?.parentElement;
    if (!header || !parent) return;
    const previousHeight = parent.style.getPropertyValue("--app-header-height");
    const measure = () => parent.style.setProperty("--app-header-height", `${Math.ceil(header.getBoundingClientRect().height)}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => {
      observer.disconnect();
      if (previousHeight) parent.style.setProperty("--app-header-height", previousHeight);
      else parent.style.removeProperty("--app-header-height");
    };
  }, []);
  const dismissAccountDetail = () => {
    headerStackRef.current?.querySelector<HTMLButtonElement>('.account-signal-toggle[aria-expanded="true"]')?.focus();
    setExpandedStatLabel(undefined);
  };
  const visibleAccountStats = accountStats.filter(
    (stat) => stat.label.trim() && stat.value.trim(),
  );
  const expandedStat = visibleAccountStats.find((stat) => stat.label === expandedStatLabel && stat.detail);
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
    <>
    <div
      ref={headerStackRef}
      className={
        visibleAccountStats.length
          ? "app-header-stack has-account-stats"
          : "app-header-stack"
      }
    >
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="topbar">
        <a
          className="brand"
          href={homeHref}
          aria-label="ProofOfWork.Me home"
        >
          <BrandMark />
          <div>
            <Title className="app-brand-title">{title}</Title>
            {subtitle ? <span>{subtitle}</span> : null}
          </div>
        </a>

        {navigationControls ?? <DomainNav onNavigate={onDomainNavigate} />}

        <div className="topbar-actions">
          <AppearanceMenu />
          {onRefresh ? (
            <button
              aria-label={busy ? "Refreshing" : "Refresh"}
              className="topbar-action-button topbar-refresh-button"
              disabled={busy}
              onClick={() => { onRefreshRecovery?.(); void refreshAction(); }}
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
          ) : !hasUnisat && isMobileWalletBrowser(navigator) ? (
            <UnisatMobileHandoff className="topbar-action-button topbar-wallet-button" />
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
              key={stat.label}
              role="listitem"
            >
              {stat.detail ? (
                <button
                  className="account-signal-toggle"
                  type="button"
                  aria-controls={accountDetailId}
                  aria-expanded={expandedStat?.label === stat.label}
                  aria-label={`${stat.label}: ${stat.value}. Details`}
                  onClick={() => setExpandedStatLabel(expandedStat?.label === stat.label ? undefined : stat.label)}
                  onKeyDown={(event) => { if (event.key === "Escape") dismissAccountDetail(); }}
                >
                  <strong>{stat.value}</strong>
                  <span>{stat.label}<ChevronDown aria-hidden="true" size={14} /></span>
                </button>
              ) : <><strong>{stat.value}</strong><span>{stat.label}</span></>}
            </div>
          ))}
        </div>
      ) : null}
      {visibleAccountStats.length ? (
        <div className="account-signal-detail" id={accountDetailId} hidden={!expandedStat}
          role="region" aria-label="Account details" tabIndex={expandedStat ? 0 : undefined}
          onKeyDown={(event) => { if (event.key === "Escape") dismissAccountDetail(); }}>
          {expandedStat ? <><strong>{expandedStat.label}: {expandedStat.value}.</strong> {expandedStat.detail}</> : null}
        </div>
      ) : null}
      <span className="skip-target" id="main-content" tabIndex={-1} />
    </div>
    {afterHeader}
    </>
  );
}
