import type { Dispatch, ReactNode, SetStateAction } from "react";
import { HOME_APP_URL, LOCAL_HOME_APP_URL } from "../../app/appLinks";
import { appHref } from "../../app/routeRegistry";
import { shortAddress } from "../../functions";
import type { BitcoinNetwork } from "../bitcoin/networks";
import { UNISAT_DOWNLOAD_URL } from "../wallet/walletLinks";
import { DomainNav } from "./DomainNav";
import { HeaderActionsMenu } from "./HeaderActionsMenu";
import {
  ArrowUpRight,
  LogOut,
  Moon,
  RefreshCw,
  Sun,
  Wallet,
} from "lucide-react";

type ThemeMode = "light" | "dark";

export function AppHeader({
  address = "",
  brandClassName = "brand",
  busy = false,
  className = "id-launch-topbar",
  connectWallet,
  disconnectWallet,
  domainNavCompact = true,
  hasUnisat = true,
  homeHref = appHref(HOME_APP_URL, LOCAL_HOME_APP_URL),
  mark = "PoW",
  network,
  onNetworkChange,
  onRefresh,
  setTheme,
  subtitle,
  theme,
  title,
}: {
  address?: string;
  brandClassName?: string;
  busy?: boolean;
  className?: string;
  connectWallet?: () => void;
  disconnectWallet?: () => void;
  domainNavCompact?: boolean;
  hasUnisat?: boolean;
  homeHref?: string;
  mark?: ReactNode;
  network?: BitcoinNetwork;
  onNetworkChange?: (network: BitcoinNetwork) => void;
  onRefresh?: () => void;
  setTheme: Dispatch<SetStateAction<ThemeMode>>;
  subtitle?: string;
  theme: ThemeMode;
  title: string;
}) {
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

  return (
    <header className={className}>
      <a
        className={brandClassName}
        href={homeHref}
        aria-label="ProofOfWork.Me home"
      >
        <div className="brand-mark" aria-hidden="true">
          {mark}
        </div>
        <div>
          <h1>{title}</h1>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
      </a>

      <DomainNav compact={domainNavCompact} />

      <div className="topbar-controls topbar-actions-desktop">
        <button
          aria-label={theme === "dark" ? "Use light mode" : "Use dark mode"}
          className="icon-button"
          disabled={busy}
          onClick={() =>
            setTheme((current) => (current === "dark" ? "light" : "dark"))
          }
          title={theme === "dark" ? "Light mode" : "Dark mode"}
          type="button"
        >
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </button>

        {onRefresh ? (
          <button
            className="secondary"
            disabled={busy}
            onClick={onRefresh}
            title="Refresh chain data"
            type="button"
          >
            <span className="button-content">
              <RefreshCw className={busy ? "refresh-spin" : ""} size={16} />
              <span>{busy ? "Refreshing" : "Refresh"}</span>
            </span>
          </button>
        ) : null}

        {networkOptions.length ? (
          <div className="network-tabs" aria-label="Bitcoin network">
            {networkOptions.map((option) => (
              <button
                aria-pressed={option.active}
                disabled={busy}
                key={option.network}
                onClick={() => onNetworkChange?.(option.network)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}

        {hasUnisat ? (
          <button
            className="secondary"
            disabled={busy || !connectWallet}
            onClick={connectWallet}
            type="button"
          >
            <span className="button-content">
              <Wallet size={16} />
              <span>{address ? shortAddress(address) : "Connect UniSat"}</span>
            </span>
          </button>
        ) : (
          <a
            className="secondary link-button"
            href={UNISAT_DOWNLOAD_URL}
            rel="noreferrer"
            target="_blank"
          >
            <span className="button-content">
              <Wallet size={16} />
              <span>Install UniSat</span>
              <ArrowUpRight size={15} />
            </span>
          </a>
        )}

        {address && disconnectWallet ? (
          <button
            className="secondary"
            disabled={busy}
            onClick={disconnectWallet}
            type="button"
          >
            <span className="button-content">
              <LogOut size={16} />
              <span>Disconnect</span>
            </span>
          </button>
        ) : null}
      </div>

      <div className="topbar-actions topbar-actions-mobile">
        <HeaderActionsMenu
          address={address}
          busy={busy}
          connectWallet={connectWallet}
          disconnectWallet={disconnectWallet}
          hasUnisat={hasUnisat}
          networkOptions={networkOptions.map((option) => ({
            active: option.active,
            disabled: busy,
            label: option.label,
            onSelect: () => onNetworkChange?.(option.network),
          }))}
          onRefresh={onRefresh}
          setTheme={setTheme}
          theme={theme}
        />
      </div>
    </header>
  );
}
