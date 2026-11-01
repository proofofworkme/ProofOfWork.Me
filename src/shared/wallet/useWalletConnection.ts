import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { errorMessage } from "../../functions";
import type { BitcoinNetwork } from "../bitcoin/networks";
import { createWalletConnectionController } from "./walletConnection.mjs";

export type EmbeddedWalletSession = {
  address: string;
  network: BitcoinNetwork;
  busy: boolean;
  getRevision?: () => number;
  connect: () => void | Promise<void>;
  disconnect: () => void | Promise<void>;
};

type Account = { address: string; network: BitcoinNetwork };
type Options = Account & {
  embedded: boolean;
  session?: EmbeddedWalletSession;
  hasUnisat: boolean;
  beforeChange: () => boolean;
  onChange: (account: Account) => void;
  onInvalidate: () => void;
  onStatus: Dispatch<SetStateAction<string>>;
  onError: Dispatch<SetStateAction<string>>;
};

function sameConnectedAddress(left: string, right: string) {
  const first = left.trim(), second = right.trim();
  if (!first || !second) return false;
  if (first === second) return true;
  return /^(bc1|tb1|bcrt1)/iu.test(first) && /^(bc1|tb1|bcrt1)/iu.test(second) && first.toLowerCase() === second.toLowerCase();
}

/** Standalone discovery uses the shared controller. Computer owns embedded sessions. */
export function useWalletConnection(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const [controller] = useState(() => createWalletConnectionController());
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  const revision = useRef(0);
  const reviewRevision = useRef(0);
  const explicitFlight = useRef<Promise<void>>();
  const disconnecting = useRef(false);
  const connectionError = useRef("");
  const connectionStatus = useRef("");
  const reportError = useCallback((message: string) => {
    connectionError.current = message;
    latest.current.onError(message);
  }, []);
  const reportStatus = useCallback((message: string) => {
    connectionStatus.current = message;
    latest.current.onStatus(message);
  }, []);
  const invalidateReview = useCallback(() => {
    reviewRevision.current++;
    latest.current.onInvalidate();
  }, []);
  const getRevision = useCallback(() => latest.current.embedded
    ? latest.current.session?.getRevision?.() ?? reviewRevision.current
    : reviewRevision.current, []);

  const invalidate = useCallback(() => {
    revision.current++;
    controller.invalidate();
    explicitFlight.current = undefined;
    if (mounted.current) setBusy(false);
  }, [controller]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; invalidate(); };
  }, [invalidate]);

  // A new reading network or parent session supersedes an unfinished request.
  useEffect(() => {
    invalidate();
    if (options.embedded) invalidateReview();
  }, [options.network, options.embedded, options.session?.address, options.session?.network, invalidate, invalidateReview]);

  const discover = useCallback(async (authorize: boolean) => {
    const wallet = window.unisat;
    if (!wallet) {
      if (authorize) reportError("UniSat is not installed.");
      return;
    }
    const generation = ++revision.current;
    const selectedNetwork = latest.current.network;
    const current = () => mounted.current && generation === revision.current &&
      wallet === window.unisat && !latest.current.embedded;
    if (authorize) { setBusy(true); reportError(""); }
    try {
      const account = await controller.connect(wallet, {
        authorize,
        requiredNetwork: authorize ? selectedNetwork : undefined,
        sameAddress: sameConnectedAddress,
        isCurrent: current,
        onStage: authorize ? ({ message }) => { if (current()) reportStatus(message); } : undefined,
      });
      if (!current()) return;
      // Approval can finish after a disconnected draft became unsavable.
      // Keep that draft in its original scope until it can be preserved.
      if (!latest.current.address && !latest.current.beforeChange()) return;
      latest.current.onChange(account);
      if (authorize) reportStatus("UniSat connected. Signing stays in your wallet.");
      else if (connectionError.current) {
        const previousError = connectionError.current, previousStatus = connectionStatus.current;
        connectionError.current = "";
        latest.current.onError(message => message === previousError ? "" : message);
        latest.current.onStatus(message => message === previousStatus ? "UniSat connected. Signing stays in your wallet." : message);
      }
    } catch (error) {
      if (!current() || (error as { code?: string })?.code === "stale") return;
      invalidateReview();
      const hadAddress = Boolean(latest.current.address);
      if (!authorize) latest.current.onChange({ address: "", network: latest.current.network });
      if (!authorize && (error as { code?: string })?.code === "no-account") {
        if (hadAddress) reportStatus("Wallet account disconnected.");
        return;
      }
      reportError(errorMessage(error, "Could not verify the UniSat connection. Retry Connect."));
      reportStatus("");
    } finally {
      if (current() && authorize) setBusy(false);
    }
  }, [controller, invalidateReview, reportError, reportStatus]);

  useEffect(() => {
    if (options.embedded || !options.hasUnisat) return;
    const wallet = window.unisat;
    if (!wallet) return;
    const changed = () => {
      invalidateReview();
      // Approval/switch events belong to the active controller's final checks.
      if (controller.isConnecting || disconnecting.current) return;
      invalidate();
      void discover(false);
    };
    void discover(false);
    wallet.on?.("accountsChanged", changed);
    wallet.on?.("networkChanged", changed);
    wallet.on?.("chainChanged", changed);
    return () => {
      wallet.removeListener?.("accountsChanged", changed);
      wallet.removeListener?.("networkChanged", changed);
      wallet.removeListener?.("chainChanged", changed);
      invalidate();
    };
  }, [options.embedded, options.hasUnisat, controller, discover, invalidate, invalidateReview]);

  const connect = useCallback((): Promise<void> => {
    if (explicitFlight.current) return explicitFlight.current;
    if (!latest.current.beforeChange()) return Promise.resolve();
    if (latest.current.embedded) {
      if (latest.current.session) return Promise.resolve(latest.current.session.connect());
      latest.current.onError("Connect UniSat in the Computer header.");
      return Promise.resolve();
    }
    invalidate();
    let task: Promise<void>;
    task = discover(true).finally(() => {
      if (explicitFlight.current === task) explicitFlight.current = undefined;
    });
    explicitFlight.current = task;
    return task;
  }, [discover, invalidate]);

  const disconnect = useCallback(async () => {
    if (!latest.current.beforeChange()) return;
    if (latest.current.embedded) {
      await latest.current.session?.disconnect();
      return;
    }
    invalidate();
    const generation = revision.current;
    const current = () => mounted.current && generation === revision.current;
    invalidateReview();
    latest.current.onChange({ address: "", network: latest.current.network });
    latest.current.onError("");
    latest.current.onStatus("Disconnecting UniSat...");
    disconnecting.current = true;
    setBusy(true);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(() => window.unisat?.disconnect?.()),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error("UniSat disconnect did not finish within 15 seconds.")), 15_000);
        }),
      ]);
      if (current()) latest.current.onStatus("Wallet disconnected.");
    } catch (error) {
      if (current()) latest.current.onError(`Local account cleared. ${errorMessage(error, "Wallet disconnect failed.")}`);
    } finally {
      clearTimeout(timeout);
      disconnecting.current = false;
      if (current()) setBusy(false);
    }
  }, [invalidate, invalidateReview]);

  return { connect, disconnect, invalidate, getRevision, busy: options.embedded ? Boolean(options.session?.busy) : busy };
}
