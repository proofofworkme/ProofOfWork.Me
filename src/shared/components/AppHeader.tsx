import type { Dispatch, ReactNode, SetStateAction } from "react";
import { HOME_APP_URL, LOCAL_HOME_APP_URL } from "../../app/appLinks";
import { appHref } from "../../app/routeRegistry";
import type { BitcoinNetwork } from "../bitcoin/networks";
import { DomainNav } from "./DomainNav";
import { HeaderActionsMenu } from "./HeaderActionsMenu";
import { NetworkSelectMenu } from "./NetworkSelectMenu";

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

      <div className="topbar-actions">
        {network && onNetworkChange ? (
          <NetworkSelectMenu
            disabled={busy}
            network={network}
            onChange={onNetworkChange}
          />
        ) : null}
        <HeaderActionsMenu
          address={address}
          busy={busy}
          connectWallet={connectWallet}
          disconnectWallet={disconnectWallet}
          hasUnisat={hasUnisat}
          onRefresh={onRefresh}
          setTheme={setTheme}
          theme={theme}
        />
      </div>
    </header>
  );
}
