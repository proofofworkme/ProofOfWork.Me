const CHAIN_NETWORKS = Object.freeze({
  BITCOIN_MAINNET: "livenet",
  BITCOIN_TESTNET: "testnet",
  BITCOIN_TESTNET4: "testnet4",
});
const NETWORK_CHAINS = Object.freeze(Object.fromEntries(
  Object.entries(CHAIN_NETWORKS).map(([chain, network]) => [network, chain]),
));
const NETWORK_LABELS = Object.freeze({ livenet: "Mainnet", testnet: "Testnet3", testnet4: "Testnet4" });

export class WalletConnectionError extends Error {
  constructor(code, message, stage) {
    super(message);
    this.name = "WalletConnectionError";
    this.code = code;
    this.stage = stage;
  }
}

/**
 * Owns account/network discovery only. Signing and transaction preflights stay
 * with their existing local-wallet paths. Provider promises cannot be cancelled;
 * retain pending calls so retry does not open a second authorization prompt.
 */
export function createWalletConnectionController({
  authorizationTimeoutMs = 60_000,
  stageTimeoutMs = 15_000,
  switchTimeoutMs = 30_000,
} = {}) {
  for (const value of [authorizationTimeoutMs, stageTimeoutMs, switchTimeoutMs]) {
    if (!Number.isFinite(value) || value <= 0) throw new TypeError("Wallet deadlines must be positive finite milliseconds.");
  }
  const pendingByWallet = new WeakMap();
  let revision = 0;
  let active;

  const staleError = () => new WalletConnectionError("stale", "The wallet connection attempt was superseded.");
  const isCurrent = (attempt) => active === attempt && attempt.revision === revision && !attempt.abort.signal.aborted && (attempt.options.isCurrent?.() ?? true);
  const assertCurrent = (attempt) => {
    if (!isCurrent(attempt)) throw staleError();
  };

  function invalidate() {
    revision += 1;
    active?.abort.abort();
    active = undefined;
  }

  function pendingCall(wallet, method, args = []) {
    let pending = pendingByWallet.get(wallet);
    if (!pending) {
      pending = new Map();
      pendingByWallet.set(wallet, pending);
    }
    // Read RPCs can be repeated safely and must be fresh on retry: retaining a
    // permanently unresolved getChain/getAccounts would make recovery impossible.
    const interactive = method === "requestAccounts" || method === "switchChain" || method === "switchNetwork";
    if (!interactive) return Promise.resolve().then(() => wallet[method](...args));
    const key = `${method}:${JSON.stringify(args)}`;
    const existing = pending.get(key);
    if (existing) return existing;
    // Do not issue competing network switch prompts with different targets.
    if ((method === "switchChain" || method === "switchNetwork") && [...pending.keys()].some((entry) => entry.startsWith("switchChain:") || entry.startsWith("switchNetwork:"))) {
      throw new WalletConnectionError("pending-switch", "A UniSat network switch is still pending. Finish or close its prompt, then retry.", "switch");
    }
    const promise = Promise.resolve().then(() => wallet[method](...args));
    pending.set(key, promise);
    // Both handlers own cleanup, including rejection after a local deadline.
    promise.then(() => pending.delete(key), () => pending.delete(key));
    return promise;
  }

  async function call(attempt, method, args, stage, timeoutMs, message, retainedPromise) {
    assertCurrent(attempt);
    attempt.options.onStage?.({ stage, message });
    assertCurrent(attempt);
    const promise = retainedPromise ?? pendingCall(attempt.wallet, method, args);
    const signal = attempt.abort.signal;
    let timer;
    let onAbort;
    try {
      const result = await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new WalletConnectionError(
            "timeout",
            `${message.replace(/\.\.\.$/u, "")} did not finish within ${Math.ceil(timeoutMs / 1000)} seconds. Finish or close any pending UniSat prompt, then retry. No transaction was requested.`,
            stage,
          )), timeoutMs);
          onAbort = () => reject(staleError());
          signal.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
      assertCurrent(attempt);
      return result;
    } catch (error) {
      // A rejected provider call from an obsolete attempt must not clear the
      // account or status owned by the replacement attempt.
      assertCurrent(attempt);
      throw error;
    } finally {
      clearTimeout(timer);
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
  }

  async function readNetwork(attempt) {
    if (typeof attempt.wallet.getChain === "function") {
      let chain;
      try {
        chain = await call(attempt, "getChain", [], "network", stageTimeoutMs, "Verifying the UniSat network...");
      } catch (error) {
        if (error instanceof WalletConnectionError) throw error;
        // Older provider versions can expose getChain without supporting it.
        assertCurrent(attempt);
      }
      if (chain && Object.prototype.hasOwnProperty.call(CHAIN_NETWORKS, chain.enum)) return CHAIN_NETWORKS[chain.enum];
    }
    if (typeof attempt.wallet.getNetwork === "function") {
      const network = await call(attempt, "getNetwork", [], "network", stageTimeoutMs, "Verifying the UniSat network...");
      // Legacy getNetwork cannot distinguish Testnet4 from Testnet3.
      if (network === "livenet" || network === "testnet") return network;
    }
    throw new WalletConnectionError("network-unavailable", "UniSat did not report a supported network. Select the intended network in UniSat, then retry. No transaction was requested.", "network");
  }

  function firstAccount(accounts) {
    return Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0].trim() : "";
  }

  async function run(attempt) {
    const { wallet, options } = attempt;
    const authorize = options.authorize !== false;
    const accountMethod = authorize && typeof wallet.requestAccounts === "function" ? "requestAccounts" : "getAccounts";
    if (typeof wallet[accountMethod] !== "function" || typeof wallet.getAccounts !== "function") {
      throw new WalletConnectionError("account-unavailable", "This UniSat provider cannot verify its active account. Update or reopen UniSat, then retry.", "accounts");
    }
    // A timed-out authorization can remain unresolved even after the extension
    // has granted access. Retry first probes the already-authorized account;
    // only an empty probe waits on the original prompt again.
    let accounts;
    const pendingAuthorization = authorize ? pendingByWallet.get(wallet)?.get("requestAccounts:[]") : undefined;
    if (pendingAuthorization) {
      accounts = await call(attempt, "getAccounts", [], "accounts", stageTimeoutMs, "Reading the UniSat account...");
    }
    if (!firstAccount(accounts)) {
      accounts = await call(attempt, accountMethod, [], "accounts", accountMethod === "requestAccounts" ? authorizationTimeoutMs : stageTimeoutMs,
        accountMethod === "requestAccounts" ? "Waiting for UniSat account approval..." : "Reading the UniSat account...", pendingAuthorization);
    }
    const address = firstAccount(accounts);
    if (!address) throw new WalletConnectionError("no-account", "UniSat did not return an account. Unlock it and approve this site's connection, then retry.", "accounts");
    let network = await readNetwork(attempt);
    if (options.requiredNetwork && network !== options.requiredNetwork) {
      const target = options.requiredNetwork;
      if (!Object.prototype.hasOwnProperty.call(NETWORK_CHAINS, target)) throw new TypeError("Unsupported required wallet network.");
      if (typeof wallet.switchChain === "function") {
        await call(attempt, "switchChain", [NETWORK_CHAINS[target]], "switch", switchTimeoutMs, `Switching UniSat to ${NETWORK_LABELS[target]}...`);
      } else if (typeof wallet.switchNetwork === "function" && target !== "testnet4") {
        await call(attempt, "switchNetwork", [target], "switch", switchTimeoutMs, `Switching UniSat to ${NETWORK_LABELS[target]}...`);
      } else {
        throw new WalletConnectionError("network-mismatch", `Select ${NETWORK_LABELS[target]} in UniSat, then retry. No transaction was requested.`, "switch");
      }
      network = await readNetwork(attempt);
      if (network !== target) throw new WalletConnectionError("network-mismatch", `UniSat did not switch to ${NETWORK_LABELS[target]}. No transaction was requested.`, "network");
    }
    const verifiedAddress = firstAccount(await call(attempt, "getAccounts", [], "verify", stageTimeoutMs, "Verifying the active UniSat account..."));
    const sameAddress = options.sameAddress ?? ((left, right) => left === right);
    if (!verifiedAddress || !sameAddress(address, verifiedAddress)) {
      throw new WalletConnectionError("account-changed", "The active UniSat account changed while connecting. Retry with the intended account. No transaction was requested.", "verify");
    }
    const verifiedNetwork = await readNetwork(attempt);
    if (verifiedNetwork !== network) throw new WalletConnectionError("network-changed", "The UniSat network changed while connecting. Retry on the intended network. No transaction was requested.", "network");
    assertCurrent(attempt);
    return { address: verifiedAddress, network: verifiedNetwork };
  }

  function connect(wallet, options = {}) {
    if (!wallet || (typeof wallet !== "object" && typeof wallet !== "function")) return Promise.reject(new WalletConnectionError("provider-unavailable", "UniSat is not installed."));
    if (active) {
      if (isCurrent(active) && active.wallet === wallet && active.options.requiredNetwork === options.requiredNetwork && active.options.authorize === options.authorize) return active.promise;
      invalidate();
    }
    const attempt = { wallet, options, revision: ++revision, abort: new AbortController() };
    active = attempt;
    attempt.promise = Promise.resolve().then(() => run(attempt)).finally(() => {
      if (active === attempt) active = undefined;
    });
    return attempt.promise;
  }

  return { connect, invalidate, get isConnecting() { return Boolean(active && isCurrent(active)); } };
}
