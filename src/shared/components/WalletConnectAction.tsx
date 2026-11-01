import { Wallet } from "lucide-react";
import { isMobileWalletBrowser, UNISAT_DOWNLOAD_URL } from "../wallet/walletLinks";
import { UnisatMobileHandoff } from "./UnisatMobileHandoff";

export function WalletConnectAction({ hasUnisat, busy, onConnect, label = "Connect UniSat", className = "secondary" }: {
  hasUnisat: boolean;
  busy: boolean;
  onConnect: () => void | Promise<void>;
  label?: string;
  className?: string;
}) {
  if (!hasUnisat && isMobileWalletBrowser(navigator)) return <UnisatMobileHandoff className={className} />;
  if (!hasUnisat) return <a className={`${className} link-button`} href={UNISAT_DOWNLOAD_URL} target="_blank" rel="noreferrer"><Wallet size={15} /> Install UniSat</a>;
  return <button className={className} type="button" onClick={() => void onConnect()} disabled={busy}><Wallet size={15} /> {label}</button>;
}
