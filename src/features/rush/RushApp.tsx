import type { Dispatch, FormEvent, SetStateAction } from "react";
import {
  ArrowUpRight,
  Clock,
  RefreshCw,
  Send,
  Square,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";
import { mempoolBase, mempoolTxUrl } from "../../shared/bitcoin/networks";
import { AppHeader } from "../../shared/components/AppHeader";
import {
  DataList,
  ProgressMeter,
  PublicPage,
  PublicPageHeader,
  ResponsiveGrid,
} from "../../shared/components/PublicLayout";
import { SocialFooter } from "../../shared/components/SocialFooter";
import { formatDate, shortAddress } from "../../functions";
import {
  RUSH_CHAINED_MINT_MAX_COUNT,
  RUSH_MAX_REWARDED_MINTS,
  RUSH_MINT_PAYLOAD,
  RUSH_MINT_PRICE_SATS,
  RUSH_PHASES,
  RUSH_TICKER,
  formatRushUnits,
  rushMintProgress,
  rushPhaseProgress,
  type RushMintRecord,
  type RushState,
} from "./rushProtocol";

type ThemeMode = "light" | "dark";
type StatusTone = "idle" | "good" | "bad";

export type RushAppProps = {
  address: string;
  busy: boolean;
  connectWallet: () => void;
  disconnectWallet: () => void;
  feeRate: number;
  hasUnisat: boolean;
  mintCount: number;
  mintDelayMs: number;
  minting: boolean;
  network: BitcoinNetwork;
  onMint: (event: FormEvent<HTMLFormElement>) => void;
  onNetworkChange: (network: BitcoinNetwork) => void;
  onRefresh: () => void;
  onStopMint: () => void;
  setFeeRate: (value: number) => void;
  setMintCount: (value: number) => void;
  setMintDelayMs: (value: number) => void;
  setTheme: Dispatch<SetStateAction<ThemeMode>>;
  state: RushState;
  status: { tone: StatusTone; text: string };
  theme: ThemeMode;
};

type RushHolder = {
  address: string;
  balance: string;
  balanceUnits: bigint;
};

function visibleRushMints(mints: RushMintRecord[]) {
  return mints
    .slice()
    .sort((left, right) => {
      const leftOrdinal = left.ordinal ?? Number.MAX_SAFE_INTEGER;
      const rightOrdinal = right.ordinal ?? Number.MAX_SAFE_INTEGER;
      return (
        leftOrdinal - rightOrdinal ||
        Number(right.confirmed) - Number(left.confirmed) ||
        Date.parse(right.createdAt) - Date.parse(left.createdAt)
      );
    })
    .slice(0, 12);
}

function rushHoldersFromMints(mints: RushMintRecord[]): RushHolder[] {
  const balances = new Map<string, bigint>();
  for (const mint of mints) {
    if (!mint.confirmed || mint.overflow) {
      continue;
    }

    balances.set(
      mint.minterAddress,
      (balances.get(mint.minterAddress) ?? 0n) +
        BigInt(mint.amountUnits || "0"),
    );
  }

  return Array.from(balances.entries())
    .map(([holderAddress, balanceUnits]) => ({
      address: holderAddress,
      balance: formatRushUnits(balanceUnits),
      balanceUnits,
    }))
    .sort(
      (left, right) =>
        Number(right.balanceUnits - left.balanceUnits) ||
        left.address.localeCompare(right.address),
    );
}

function networkName(network: BitcoinNetwork) {
  if (network === "testnet4") {
    return "Testnet4";
  }

  if (network === "testnet") {
    return "Testnet3";
  }

  return "Mainnet";
}

export function RushApp({
  address,
  busy,
  connectWallet,
  disconnectWallet,
  feeRate,
  hasUnisat,
  mintCount,
  mintDelayMs,
  minting,
  network,
  onMint,
  onNetworkChange,
  onRefresh,
  onStopMint,
  setFeeRate,
  setMintCount,
  setMintDelayMs,
  setTheme,
  state,
  status,
  theme,
}: RushAppProps) {
  const stats = state.stats;
  const phaseProgress = rushPhaseProgress(stats);
  const totalProgress = rushMintProgress(stats);
  const delaySeconds = Number((mintDelayMs / 1000).toFixed(2));
  const normalizedMintCount = Number.isFinite(mintCount)
    ? Math.min(RUSH_CHAINED_MINT_MAX_COUNT, Math.max(1, Math.floor(mintCount)))
    : 1;
  const recentMints = visibleRushMints(state.mints);
  const confirmedMints = state.mints.filter((mint) => mint.confirmed);
  const pendingMints = state.mints.filter((mint) => !mint.confirmed);
  const holders = rushHoldersFromMints(state.mints);
  const visibleHolders = holders.slice(0, 12);
  const registryUrl = state.registryAddress
    ? `${mempoolBase(network)}/address/${state.registryAddress}`
    : "";

  return (
    <main className="id-launch-app rush-public-app">
      <AppHeader
        address={address}
        busy={busy || minting}
        connectWallet={connectWallet}
        disconnectWallet={disconnectWallet}
        hasUnisat={hasUnisat}
        mark="R"
        network={network}
        onNetworkChange={onNetworkChange}
        onRefresh={onRefresh}
        setTheme={setTheme}
        subtitle="Chained Bitcoin mint"
        theme={theme}
        title="RUSH"
      />

      {status.tone !== "idle" ? (
        <div className={`status ${status.tone}`}>
          <span className="status-dot" aria-hidden="true" />
          <span>{status.text}</span>
        </div>
      ) : null}

      <PublicPage className="rush-workspace">
        <PublicPageHeader align="center">
          <p className="eyebrow">ProofOfWork token</p>
          <h2>RUSH token dashboard</h2>
          <p>
            Minted by confirmed Bitcoin history. RUSH mints pay the registry
            directly, then the indexer assigns rewards from canonical block
            order.
          </p>
        </PublicPageHeader>

        <section className="id-launch-card token-detail-hero">
          <div className="token-detail-title">
            <div className="empty-icon" aria-hidden="true">
              <TrendingUp size={26} />
            </div>
            <div>
              <p className="eyebrow">Token dashboard</p>
              <h2>{RUSH_TICKER}</h2>
              <div className="token-chip-row" aria-label="RUSH summary">
                <span>{stats.totalSupply} max</span>
                <span>{stats.nextReward} next mint</span>
                <span>{RUSH_MINT_PRICE_SATS.toLocaleString()} sats / mint</span>
                <span>{confirmedMints.length.toLocaleString()} mints</span>
              </div>
              <p>
                RUSH distributes one billion tokens over fifty thousand rewarded
                mints. Pending records stay visible, but only confirmed Bitcoin
                history decides final ordinal and reward.
              </p>
            </div>
          </div>
          <div className="token-detail-actions">
            <a
              className={`secondary small${registryUrl ? "" : " disabled"}`}
              href={registryUrl || undefined}
              rel="noreferrer"
              target="_blank"
            >
              <span className="button-content">
                <ArrowUpRight size={15} />
                <span>Registry</span>
              </span>
            </a>
            <button
              className="secondary small"
              disabled={busy}
              onClick={onRefresh}
              type="button"
            >
              <span className="button-content">
                <RefreshCw size={15} />
                <span>Refresh</span>
              </span>
            </button>
          </div>
          <div className="token-progress-block">
            <div className="token-progress-copy">
              <span>Mint progress</span>
              <strong>{totalProgress}%</strong>
            </div>
            <ProgressMeter label="RUSH mint progress" progress={totalProgress} />
            <p className="field-note">
              {stats.distributed} / {stats.totalSupply} {RUSH_TICKER} confirmed.{" "}
              {stats.remaining} remaining.
            </p>
          </div>
        </section>

        <div className="id-launch-stats token-detail-stats">
          <div>
            <strong>{stats.totalSupply}</strong>
            <span>Max supply</span>
          </div>
          <div>
            <strong>{stats.distributed}</strong>
            <span>Confirmed minted</span>
          </div>
          <div>
            <strong>{holders.length.toLocaleString()}</strong>
            <span>Holders</span>
          </div>
          <div>
            <strong>{confirmedMints.length.toLocaleString()}</strong>
            <span>Confirmed mints</span>
          </div>
        </div>

        <ResponsiveGrid variant="cards">
          <section className="id-launch-card product-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Deployment</p>
                <h3>Protocol deployment</h3>
              </div>
              <strong>{networkName(network)}</strong>
            </div>
            <DataList
              items={[
                { label: "Token", value: RUSH_TICKER },
                { label: "Payload", value: RUSH_MINT_PAYLOAD },
                {
                  label: "Mint price",
                  value: `${RUSH_MINT_PRICE_SATS.toLocaleString()} sats`,
                },
                { label: "Registry", value: shortAddress(state.registryAddress) },
                {
                  label: "Rewarded mints",
                  value: RUSH_MAX_REWARDED_MINTS.toLocaleString(),
                },
              ]}
            />
            <p className="field-note">
              RUSH does not use a generic token deploy transaction. Its
              deployment is the fixed protocol rule: payment to this registry
              before the exact RUSH OP_RETURN, then rewards indexed by confirmed
              order.
            </p>
          </section>

          <section className="id-launch-card product-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Phase</p>
                <h3>{stats.currentPhase ? `Phase ${stats.currentPhase}` : "Complete"}</h3>
              </div>
              <strong>{phaseProgress}%</strong>
            </div>
            <ProgressMeter label="Current RUSH phase" progress={phaseProgress} />
            <div className="rush-phase-list">
              {RUSH_PHASES.map((phase) => (
                <div
                  className={phase.phase === stats.currentPhase ? "is-active" : ""}
                  key={phase.phase}
                >
                  <span>Phase {phase.phase}</span>
                  <strong>{phase.reward} RUSH</strong>
                  <small>
                    {phase.startOrdinal.toLocaleString()}-
                    {phase.endOrdinal.toLocaleString()}
                  </small>
                </div>
              ))}
            </div>
          </section>
        </ResponsiveGrid>

        <ResponsiveGrid variant="cards">
          <form className="id-launch-card id-form product-card" onSubmit={onMint}>
            <div className="section-heading">
              <div>
                <p className="eyebrow">Mint</p>
                <h3>Chained mint assistant</h3>
              </div>
              <strong>{RUSH_MINT_PRICE_SATS.toLocaleString()} sats / mint</strong>
            </div>

            <label>
              Mints
              <input
                disabled={minting}
                max={RUSH_CHAINED_MINT_MAX_COUNT}
                min={1}
                onChange={(event) => setMintCount(Number(event.target.value))}
                type="number"
                value={mintCount || ""}
              />
            </label>

            <label>
              Fee rate
              <input
                disabled={minting}
                min={0.1}
                onChange={(event) => setFeeRate(Number(event.target.value))}
                step={0.1}
                type="number"
                value={feeRate}
              />
            </label>

            <label>
              Delay seconds
              <input
                disabled={minting}
                max={30}
                min={0}
                onChange={(event) =>
                  setMintDelayMs(Number(event.target.value) * 1000)
                }
                step={0.1}
                type="number"
                value={delaySeconds}
              />
            </label>

            <DataList
              items={[
                {
                  label: "Run cost",
                  value: `${(
                    normalizedMintCount * RUSH_MINT_PRICE_SATS
                  ).toLocaleString()} sats + fees`,
                },
                {
                  label: "Max run",
                  value: `${RUSH_CHAINED_MINT_MAX_COUNT.toLocaleString()} mints`,
                },
                {
                  label: "Wallet",
                  value: address ? shortAddress(address) : "Not connected",
                },
              ]}
            />

            <div className="token-assistant-actions">
              <button className="primary" disabled={busy || minting} type="submit">
                <span className="button-content">
                  {address ? <Send size={16} /> : <Wallet size={16} />}
                  <span>
                    {address ? `Mint ${normalizedMintCount} RUSH` : "Connect wallet"}
                  </span>
                </span>
              </button>
              <button
                className="secondary"
                disabled={!minting}
                onClick={onStopMint}
                type="button"
              >
                <span className="button-content">
                  <Square size={15} />
                  <span>Stop</span>
                </span>
              </button>
            </div>

            <p className="field-note">
              The first transaction spends a confirmed wallet UTXO. Later mints
              spend the previous pending child output. If one broadcast fails,
              the assistant stops.
            </p>
          </form>

          <section className="id-launch-card product-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Balances</p>
                <h3>Top holders</h3>
                <p>Confirmed balances for {RUSH_TICKER}.</p>
              </div>
              <Users size={22} />
            </div>

            {visibleHolders.length === 0 ? (
              <div className="empty-state">
                <strong>No holders yet.</strong>
                <span>The first confirmed RUSH mint will appear here.</span>
              </div>
            ) : (
              <div className="id-record-list">
                {visibleHolders.map((holder) => (
                  <article className="id-record" key={holder.address}>
                    <div>
                      <strong>
                        {holder.balance} {RUSH_TICKER}
                      </strong>
                      <code>{holder.address}</code>
                    </div>
                    <a
                      className="secondary small"
                      href={`${mempoolBase(network)}/address/${holder.address}`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <span className="button-content">
                        <ArrowUpRight size={15} />
                        <span>Address</span>
                      </span>
                    </a>
                  </article>
                ))}
              </div>
            )}
          </section>
        </ResponsiveGrid>

        <section className="id-launch-card">
          <div className="id-card-head">
            <div className="empty-icon" aria-hidden="true">
              <Clock size={24} />
            </div>
            <div>
              <h3>Mint log</h3>
              <p>Sorted by confirmation date. Pending records stay visible.</p>
            </div>
          </div>

          {recentMints.length === 0 ? (
            <div className="empty-state">
              <strong>No RUSH mints indexed yet.</strong>
              <span>Confirmed registry mints will appear here.</span>
            </div>
          ) : (
            <div className="activity-feed">
              {recentMints.map((mint) => (
                <article className="activity-row" key={mint.txid}>
                  <div className="activity-row-main">
                    <div>
                      <h4>
                        {mint.ordinal
                          ? `#${mint.ordinal.toLocaleString()}`
                          : "Pending"}{" "}
                        - {mint.amount} {RUSH_TICKER}
                      </h4>
                      <strong>{shortAddress(mint.minterAddress)}</strong>
                      <p>
                        {mint.confirmed ? "Confirmed" : "Pending"} -{" "}
                        {mint.paidSats.toLocaleString()} sats
                      </p>
                    </div>
                    <time dateTime={mint.createdAt}>
                      {formatDate(mint.createdAt)}
                    </time>
                  </div>
                  <div className="id-record-actions">
                    <a
                      className="secondary small"
                      href={mempoolTxUrl(mint.txid, mint.network)}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <span className="button-content">
                        <ArrowUpRight size={15} />
                        <span>View TX</span>
                      </span>
                    </a>
                  </div>
                </article>
              ))}
            </div>
          )}
          <p className="field-note">
            Pending mints estimate the next reward but do not consume canonical
            supply until they confirm.
            {pendingMints.length > 0
              ? ` ${pendingMints.length.toLocaleString()} pending mint${
                  pendingMints.length === 1 ? "" : "s"
                } visible.`
              : ""}
          </p>
        </section>
      </PublicPage>
      <SocialFooter />
    </main>
  );
}
