import type { ReactNode } from "react";
import { HOME_APP_URL, LOCAL_HOME_APP_URL } from "../../app/appLinks";
import { appHref } from "../../app/routeRegistry";
import type { BitcoinNetwork } from "../bitcoin/networks";
import { DomainNav } from "./DomainNav";
import { HeaderActionsMenu } from "./HeaderActionsMenu";

export function AppHeader({
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
  address?: string;
  busy?: boolean;
  connectWallet?: () => void;
  disconnectWallet?: () => void;
  hasUnisat?: boolean;
  homeHref?: string;
  mark?: ReactNode;
  network?: BitcoinNetwork;
  onDomainNavigate?: (label: string) => boolean | void;
  onNetworkChange?: (network: BitcoinNetwork) => void;
  onRefresh?: () => void;
  subtitle?: string;
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
  const refreshAction =
    onRefresh ??
    (() => {
      if (typeof window !== "undefined") window.location.reload();
    });

  return (
    <header className="topbar">
      <a
        className="brand"
        href={homeHref}
        aria-label="ProofOfWork.Me home"
      >
        <div className="brand-mark" aria-hidden="true">
          <img src="/proofofwork-logo.png" alt="" />
        </div>
        <div>
          <h1>{title}</h1>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
      </a>

      <DomainNav onNavigate={onDomainNavigate} />

      <div className="topbar-actions">
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
          onRefresh={refreshAction}
        />
      </div>
    </header>
  );
}
