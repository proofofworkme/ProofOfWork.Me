import type { CSSProperties, FormEvent } from "react";
import * as bitcoin from "bitcoinjs-lib";
import { ArrowUpRight, MessageCircle, MessageSquareQuote, Mic2, RefreshCw, Send, TrendingUp, X } from "lucide-react";
import {
  LOCAL_PAY2SPEAK_APP_URL,
  PAY2SPEAK_APP_URL,
} from "../../app/appLinks";
import { appHref } from "../../app/routeRegistry";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";
import { mempoolBase, mempoolTxUrl } from "../../shared/bitcoin/networks";
import { MAX_DATA_CARRIER_BYTES } from "../../shared/bitcoin/protocolLimits";
import { AppHeader } from "../../shared/components/AppHeader";
import { FeeRateControl } from "../../shared/components/FeeRateControl";
import { ProgressBar } from "../../shared/components/ProgressBar";
import { SocialFooter } from "../../shared/components/SocialFooter";
import { formatDate, shortAddress } from "../../functions";
import {
  pay2SpeakCampaignProgress,
  pay2SpeakCreatorUrl,
  type Pay2SpeakCampaign,
  type Pay2SpeakFunding,
  type Pay2SpeakQuestion,
} from "./pay2speakProtocol";

type ThemeMode = "light" | "dark";
type StatusTone = "idle" | "good" | "bad";

function isValidBitcoinAddress(address: string, network: BitcoinNetwork) {
  try {
    bitcoin.address.toOutputScript(
      address,
      network === "livenet" ? bitcoin.networks.bitcoin : bitcoin.networks.testnet,
    );
    return true;
  } catch {
    return false;
  }
}

export type Pay2SpeakWorkspaceProps = {
  address: string;
  busy: boolean;
  campaignBytes: number;
  campaigns: Pay2SpeakCampaign[];
  canCreateCampaign: boolean;
  canFundCampaign: boolean;
  compact?: boolean;
  contributionSats: number;
  createCampaign: (event: FormEvent<HTMLFormElement>) => void;
  creatorRouteAddress?: string;
  feeRate: number;
  fundCampaign: (event: FormEvent<HTMLFormElement>) => void;
  fundingBytes: number;
  fundingRecords: Pay2SpeakFunding[];
  handle: string;
  network: BitcoinNetwork;
  question: string;
  questions: Pay2SpeakQuestion[];
  registryAddress: string;
  selectedCampaignId: string;
  setContributionSats: (value: number) => void;
  setFeeRate: (value: number) => void;
  setHandle: (value: string) => void;
  setQuestion: (value: string) => void;
  setSelectedCampaignId: (value: string) => void;
  setSpaceNumber: (value: number) => void;
  setTargetSats: (value: number) => void;
  spaceNumber: number;
  split?: { creatorSats: number; grossSats: number; registrySats: number };
  targetSats: number;
  onRefresh: () => void;
};

export function Pay2SpeakApp({
  address,
  busy,
  connectWallet,
  disconnectWallet,
  hasUnisat,
  onNetworkChange,
  setTheme,
  status,
  theme,
  ...workspaceProps
}: Pay2SpeakWorkspaceProps & {
  connectWallet: () => void;
  disconnectWallet: () => void;
  hasUnisat: boolean;
  onNetworkChange: (network: BitcoinNetwork) => void;
  setTheme: (value: ThemeMode | ((current: ThemeMode) => ThemeMode)) => void;
  status: { tone: StatusTone; text: string };
  theme: ThemeMode;
}) {
  const creatorRouteAddress = workspaceProps.creatorRouteAddress?.trim() ?? "";
  const showCreatorPage =
    creatorRouteAddress &&
    isValidBitcoinAddress(creatorRouteAddress, "livenet");

  return (
    <main className="id-launch-app pay2speak-public-app">
      <AppHeader
        address={address}
        busy={busy}
        connectWallet={connectWallet}
        disconnectWallet={disconnectWallet}
        hasUnisat={hasUnisat}
        network={workspaceProps.network}
        onNetworkChange={onNetworkChange}
        setTheme={setTheme}
        subtitle="X Space crowdfunding"
        theme={theme}
        title="Pay2Speak"
      />

      {status.tone !== "idle" ? (
        <div className={`status ${status.tone}`}>
          <span className="status-dot" aria-hidden="true" />
          <span>{status.text}</span>
        </div>
      ) : null}

      {showCreatorPage ? (
        <Pay2SpeakCreatorPage
          address={address}
          busy={busy}
          creatorAddress={creatorRouteAddress}
          {...workspaceProps}
        />
      ) : (
        <Pay2SpeakWorkspace address={address} busy={busy} {...workspaceProps} />
      )}
      <SocialFooter />
    </main>
  );
}

export function Pay2SpeakCreatorPage({
  address,
  busy,
  campaigns,
  canFundCampaign,
  contributionSats,
  creatorAddress,
  feeRate,
  fundCampaign,
  fundingBytes,
  fundingRecords,
  question,
  questions,
  selectedCampaignId,
  setContributionSats,
  setFeeRate,
  setQuestion,
  setSelectedCampaignId,
  split,
}: Pay2SpeakWorkspaceProps & {
  creatorAddress: string;
}) {
  const creatorCampaigns = campaigns.filter(
    (campaign) => campaign.creatorAddress === creatorAddress,
  );
  const selectedCampaign =
    creatorCampaigns.find((campaign) => campaign.txid === selectedCampaignId) ??
    creatorCampaigns.find((campaign) => campaign.status === "Funding") ??
    creatorCampaigns[0];
  const creatorFunding = fundingRecords.filter((funding) =>
    creatorCampaigns.some((campaign) => campaign.txid === funding.campaignId),
  );
  const campaignQuestions = selectedCampaign
    ? questions.filter((item) => item.campaignId === selectedCampaign.txid)
    : [];
  const totalGross = creatorCampaigns.reduce(
    (total, campaign) => total + campaign.fundedGrossSats,
    0,
  );
  const totalTarget = creatorCampaigns.reduce(
    (total, campaign) => total + campaign.targetGrossSats,
    0,
  );
  const hostHandle =
    selectedCampaign?.handle ?? creatorCampaigns[0]?.handle ?? "creator";
  const hostTitle = selectedCampaign?.title ?? `@${hostHandle}`;
  const pageProgress = selectedCampaign
    ? pay2SpeakCampaignProgress(selectedCampaign)
    : 0;
  const creatorInitial = hostHandle.slice(0, 1).toUpperCase() || "P";
  const hostPanelStyle: CSSProperties = {
    background: "var(--text)",
    border: "1px solid var(--border-strong)",
    borderRadius: 12,
    color: "var(--bg)",
    display: "grid",
    gap: 18,
    padding: 16,
  };
  const avatarStyle: CSSProperties = {
    alignItems: "center",
    aspectRatio: "1 / 1",
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "50%",
    color: "var(--text)",
    display: "flex",
    fontSize: "clamp(2.2rem, 10vw, 5rem)",
    fontWeight: 900,
    justifyContent: "center",
    maxWidth: 150,
    width: "38vw",
  };
  const ctaStyle: CSSProperties = {
    background: "var(--amber)",
    borderColor: "var(--amber)",
    color: "var(--text)",
    justifyContent: "center",
    minHeight: 46,
  };

  if (creatorCampaigns.length === 0) {
    return (
      <section className="id-launch-main">
        <div className="id-launch-card">
          <div className="id-card-head">
            <div className="empty-icon" aria-hidden="true">
              <Mic2 size={24} />
            </div>
            <div>
              <h2>No Pay2Speak campaign for this creator</h2>
              <p>
                Campaign pages are built from creation transactions signed by
                the creator address.
              </p>
            </div>
          </div>
          <code>{creatorAddress}</code>
          <a
            className="secondary link-button"
            href={appHref(PAY2SPEAK_APP_URL, LOCAL_PAY2SPEAK_APP_URL)}
          >
            <span className="button-content">
              <ArrowUpRight size={15} />
              <span>Back to Pay2Speak</span>
            </span>
          </a>
        </div>
      </section>
    );
  }

  return (
    <section className="id-launch-main">
      <div className="id-launch-hero">
        <aside
          className="id-launch-card"
          style={hostPanelStyle}
          aria-label="Pay2Speak host"
        >
          <div
            style={{
              display: "flex",
              gap: 18,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div style={avatarStyle} aria-hidden="true">
              {creatorInitial}
            </div>
            <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
              <span
                style={{
                  color: "var(--bg)",
                  fontSize: ".78rem",
                  fontWeight: 850,
                  textTransform: "uppercase",
                }}
              >
                Pay2Speak host
              </span>
              <h2
                style={{
                  color: "var(--bg)",
                  fontSize: "clamp(2rem, 7vw, 4.3rem)",
                  lineHeight: ".96",
                  overflowWrap: "anywhere",
                }}
              >
                @{hostHandle}
              </h2>
              <p
                style={{
                  color: "var(--bg)",
                  fontSize: "1rem",
                  lineHeight: 1.5,
                }}
              >
                {hostTitle}
              </p>
              <code style={{ color: "var(--bg)" }}>
                {shortAddress(creatorAddress)}
              </code>
            </div>
          </div>
          <a
            href="#pay2speak-fund"
            className="primary link-button"
            style={ctaStyle}
          >
            <span className="button-content">
              <Mic2 size={17} />
              <span>Fund this Space</span>
            </span>
          </a>
        </aside>

        <div className="id-launch-stats" aria-label="Creator campaign stats">
          <div>
            <strong>{creatorCampaigns.length.toLocaleString()}</strong>
            <span>Campaigns</span>
          </div>
          <div>
            <strong>{totalGross.toLocaleString()}</strong>
            <span>Gross sats</span>
          </div>
          <div>
            <strong>{totalTarget.toLocaleString()}</strong>
            <span>Target sats</span>
          </div>
          <div>
            <strong>{creatorFunding.length.toLocaleString()}</strong>
            <span>Funding txs</span>
          </div>
        </div>
      </div>

      <div className="id-launch-grid">
        <section className="id-launch-card id-claim-card">
          <div className="id-card-head">
            <div className="empty-icon" aria-hidden="true">
              <TrendingUp size={24} />
            </div>
            <div>
              <h2>{selectedCampaign?.title ?? "Pay2Speak campaign"}</h2>
              <p>
                {selectedCampaign?.status ?? "Funding"} from creator address{" "}
                {shortAddress(creatorAddress)}.
              </p>
            </div>
          </div>
          {selectedCampaign ? (
            <>
              <ProgressBar
                label={`${selectedCampaign.title} funding progress`}
                progress={pageProgress}
              />
              <div
                className="id-launch-stats"
                aria-label="Selected campaign stats"
              >
                <div>
                  <span>Progress</span>
                  <strong>{pageProgress}%</strong>
                </div>
                <div>
                  <span>Gross funded</span>
                  <strong>
                    {selectedCampaign.fundedGrossSats.toLocaleString()} sats
                  </strong>
                </div>
                <div>
                  <span>Target</span>
                  <strong>
                    {selectedCampaign.targetGrossSats.toLocaleString()} sats
                  </strong>
                </div>
                <div>
                  <span>Questions</span>
                  <strong>{campaignQuestions.length.toLocaleString()}</strong>
                </div>
              </div>
            </>
          ) : null}
          <div className="id-record-actions">
            <a
              className="secondary small"
              href={mempoolBase("livenet") + `/address/${creatorAddress}`}
              rel="noreferrer"
              target="_blank"
            >
              <span className="button-content">
                <ArrowUpRight size={15} />
                <span>Creator Address</span>
              </span>
            </a>
            {selectedCampaign ? (
              <a
                className="secondary small"
                href={mempoolTxUrl(selectedCampaign.txid, "livenet")}
                rel="noreferrer"
                target="_blank"
              >
                <span className="button-content">
                  <ArrowUpRight size={15} />
                  <span>Campaign TX</span>
                </span>
              </a>
            ) : null}
          </div>
        </section>

        <section id="pay2speak-fund" className="id-launch-card">
          <div className="id-card-head">
            <div className="empty-icon" aria-hidden="true">
              <MessageCircle size={24} />
            </div>
            <div>
              <h3>Send sats and a question</h3>
              <p>
                One Pay2Speak funding transaction records your gross
                contribution and optional question on chain.
              </p>
            </div>
          </div>
          <form className="id-form" onSubmit={fundCampaign}>
            <label>
              Campaign
              <select
                onChange={(event) => setSelectedCampaignId(event.target.value)}
                value={selectedCampaign?.txid ?? ""}
              >
                {creatorCampaigns.map((campaign) => (
                  <option key={campaign.txid} value={campaign.txid}>
                    {campaign.title} - {campaign.status}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Gross sats
              <input
                min={1001}
                onChange={(event) =>
                  setContributionSats(Number(event.target.value))
                }
                type="number"
                value={contributionSats}
              />
            </label>
            <label>
              Question
              <textarea
                maxLength={500}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Optional question for the host"
                value={question}
              />
            </label>
            <div className="id-launch-stats" aria-label="Contribution preview">
              <div>
                <span>Contribution</span>
                <strong>
                  {(split?.grossSats ?? contributionSats).toLocaleString()} sats
                </strong>
              </div>
              <div>
                <span>Question</span>
                <strong>{question.trim() ? "Attached" : "Optional"}</strong>
              </div>
              <div>
                <span>Network fee</span>
                <strong>Shown by wallet</strong>
              </div>
            </div>
            <div
              className={
                fundingBytes > MAX_DATA_CARRIER_BYTES
                  ? "counter bad"
                  : "counter"
              }
            >
              {fundingBytes.toLocaleString()} /{" "}
              {MAX_DATA_CARRIER_BYTES.toLocaleString()} OP_RETURN data-carrier
              bytes
            </div>
            <button
              className="primary"
              disabled={!canFundCampaign}
              style={ctaStyle}
              type="submit"
            >
              <span className="button-content">
                <Send size={16} />
                <span>{busy ? "Funding" : "Fund Campaign"}</span>
              </span>
            </button>
            {!address ? (
              <p className="field-note">
                Connect UniSat to fund this campaign.
              </p>
            ) : null}
          </form>
        </section>
      </div>

      <div className="id-launch-grid">
        <section className="id-launch-card">
          <div className="id-card-head">
            <div className="empty-icon" aria-hidden="true">
              <MessageSquareQuote size={24} />
            </div>
            <div>
              <h3>Top questions</h3>
              <p>
                Ranked by gross sats attached to valid funding transactions.
              </p>
            </div>
          </div>
          <div className="activity-feed">
            {campaignQuestions.length === 0 ? (
              <div className="empty-state">
                <h3>No questions yet</h3>
                <p>Be the first to attach a question to this Space.</p>
              </div>
            ) : (
              campaignQuestions.map((item) => (
                <article
                  className="activity-row"
                  key={`${item.txid}-${item.question}`}
                >
                  <div className="activity-row-main">
                    <div>
                      <h4>{item.grossSats.toLocaleString()} sats</h4>
                      <strong>{item.question}</strong>
                    </div>
                    <time dateTime={item.createdAt}>
                      {formatDate(item.createdAt)}
                    </time>
                  </div>
                  <div className="id-record-actions">
                    <a
                      className="secondary small"
                      href={mempoolTxUrl(item.txid, "livenet")}
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
              ))
            )}
          </div>
        </section>

        <section className="id-launch-card">
          <div className="id-card-head">
            <div className="empty-icon" aria-hidden="true">
              <Mic2 size={24} />
            </div>
            <div>
              <h3>Creator campaigns</h3>
              <p>
                {creatorCampaigns.length.toLocaleString()} campaign
                {creatorCampaigns.length === 1 ? "" : "s"} from this creator
                address. Total gross: {totalGross.toLocaleString()} /{" "}
                {totalTarget.toLocaleString()} sats.
              </p>
            </div>
          </div>
          <div className="id-record-list">
            {creatorCampaigns.map((campaign) => (
              <article className="id-record" key={campaign.txid}>
                <div className="id-record-main">
                  <div>
                    <h4>{campaign.title}</h4>
                    <span>
                      {campaign.status} -{" "}
                      {campaign.confirmed ? "Confirmed" : "Pending"} -{" "}
                      {formatDate(campaign.createdAt)}
                    </span>
                  </div>
                  <strong>{pay2SpeakCampaignProgress(campaign)}%</strong>
                </div>
                <ProgressBar
                  label={`${campaign.title} funding progress`}
                  progress={pay2SpeakCampaignProgress(campaign)}
                />
                <dl className="activity-meta">
                  <div>
                    <dt>Gross</dt>
                    <dd>
                      {campaign.fundedGrossSats.toLocaleString()} /{" "}
                      {campaign.targetGrossSats.toLocaleString()}
                    </dd>
                  </div>
                  <div>
                    <dt>Funds</dt>
                    <dd>{campaign.fundingCount.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>TX</dt>
                    <dd>{shortAddress(campaign.txid)}</dd>
                  </div>
                </dl>
                <div className="id-record-actions">
                  <button
                    className="secondary small"
                    onClick={() => setSelectedCampaignId(campaign.txid)}
                    type="button"
                  >
                    <span className="button-content">
                      <MessageCircle size={15} />
                      <span>Select</span>
                    </span>
                  </button>
                  <a
                    className="secondary small"
                    href={mempoolTxUrl(campaign.txid, "livenet")}
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
        </section>
      </div>
    </section>
  );
}
export function Pay2SpeakWorkspace({
  address,
  busy,
  campaignBytes,
  campaigns,
  canCreateCampaign,
  canFundCampaign,
  compact = false,
  contributionSats,
  createCampaign,
  feeRate,
  fundCampaign,
  fundingBytes,
  fundingRecords,
  handle,
  network,
  question,
  questions,
  registryAddress,
  selectedCampaignId,
  setContributionSats,
  setFeeRate,
  setHandle,
  setQuestion,
  setSelectedCampaignId,
  setSpaceNumber,
  setTargetSats,
  spaceNumber,
  split,
  targetSats,
  onRefresh,
}: Pay2SpeakWorkspaceProps) {
  const selectedCampaign =
    campaigns.find((campaign) => campaign.txid === selectedCampaignId) ??
    campaigns[0];
  const campaignQuestions = selectedCampaign
    ? questions.filter((item) => item.campaignId === selectedCampaign.txid)
    : [];
  const confirmedFunding = fundingRecords.filter((item) => item.confirmed);
  const totalGross = campaigns.reduce(
    (total, campaign) => total + campaign.fundedGrossSats,
    0,
  );
  const fundedCount = campaigns.filter(
    (campaign) => campaign.status === "Funded",
  ).length;

  return (
    <section className={compact ? "ids-workspace compact" : "id-launch-main"}>
      <div className="id-launch-hero">
        <div>
          <span className="landing-kicker">Mainnet only</span>
          <h2>Fund an X Space with sats.</h2>
          <p>
            Campaign creation and every funded question are small `pws1:`
            OP_RETURN records. Confirmed Bitcoin history is canonical.
          </p>
        </div>
        <div className="id-record-actions">
          <button
            className="secondary"
            disabled={busy}
            onClick={onRefresh}
            type="button"
          >
            <span className="button-content">
              <RefreshCw className={busy ? "refresh-spin" : ""} size={15} />
              <span>{busy ? "Refreshing" : "Refresh"}</span>
            </span>
          </button>
          <a
            className="secondary link-button"
            href={mempoolBase("livenet") + `/address/${registryAddress}`}
            rel="noreferrer"
            target="_blank"
          >
            <span className="button-content">
              <ArrowUpRight size={15} />
              <span>Protocol TXs</span>
            </span>
          </a>
        </div>
      </div>

      <div className="id-launch-stats" aria-label="Pay2Speak stats">
        <div>
          <strong>{campaigns.length.toLocaleString()}</strong>
          <span>Campaigns</span>
        </div>
        <div>
          <strong>{fundedCount.toLocaleString()}</strong>
          <span>Funded</span>
        </div>
        <div>
          <strong>{totalGross.toLocaleString()}</strong>
          <span>Gross sats</span>
        </div>
        <div>
          <strong>{confirmedFunding.length.toLocaleString()}</strong>
          <span>Confirmed funds</span>
        </div>
      </div>

      <div className="id-launch-grid">
        <section className="id-launch-card id-claim-card">
          <div className="id-card-head">
            <div className="empty-icon" aria-hidden="true">
              <Mic2 size={24} />
            </div>
            <div>
              <h3>Create campaign</h3>
              <p>
                Writes
                `pws1:c:&lt;space-number&gt;:&lt;x-handle&gt;:&lt;target-gross-sats&gt;`
                as a mainnet campaign record.
              </p>
            </div>
          </div>
          <form className="id-form" onSubmit={createCampaign}>
            <label>
              X handle
              <input
                autoComplete="off"
                onChange={(event) => setHandle(event.target.value)}
                placeholder="handle"
                value={handle}
              />
            </label>
            <div className="id-form-grid">
              <label>
                Space #
                <input
                  min={0}
                  onChange={(event) =>
                    setSpaceNumber(Number(event.target.value))
                  }
                  type="number"
                  value={spaceNumber}
                />
              </label>
              <label>
                Target gross sats
                <input
                  min={1001}
                  onChange={(event) =>
                    setTargetSats(Number(event.target.value))
                  }
                  type="number"
                  value={targetSats}
                />
              </label>
            </div>
            <FeeRateControl feeRate={feeRate} setFeeRate={setFeeRate} />
            <div
              className={
                campaignBytes > MAX_DATA_CARRIER_BYTES
                  ? "counter bad"
                  : "counter"
              }
            >
              {campaignBytes.toLocaleString()} /{" "}
              {MAX_DATA_CARRIER_BYTES.toLocaleString()} OP_RETURN data-carrier
              bytes
            </div>
            <button
              className="primary"
              disabled={!canCreateCampaign}
              type="submit"
            >
              <span className="button-content">
                <Send size={16} />
                <span>{busy ? "Creating" : "Create Campaign"}</span>
              </span>
            </button>
          </form>
        </section>

        <section className="id-launch-card">
          <div className="id-card-head">
            <div className="empty-icon" aria-hidden="true">
              <MessageCircle size={24} />
            </div>
            <div>
              <h3>Fund campaign</h3>
              <p>
                Funding records count gross donor spend. Questions are optional
                and ranked by attached sats.
              </p>
            </div>
          </div>
          <form className="id-form" onSubmit={fundCampaign}>
            <label>
              Campaign
              <select
                onChange={(event) => setSelectedCampaignId(event.target.value)}
                value={selectedCampaign?.txid ?? ""}
              >
                {campaigns.map((campaign) => (
                  <option key={campaign.txid} value={campaign.txid}>
                    {campaign.title} · {campaign.status}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Gross sats
              <input
                min={1001}
                onChange={(event) =>
                  setContributionSats(Number(event.target.value))
                }
                type="number"
                value={contributionSats}
              />
            </label>
            <label>
              Question
              <textarea
                maxLength={500}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Optional question for the Space"
                value={question}
              />
            </label>
            <div className="id-launch-stats" aria-label="Contribution preview">
              <div>
                <span>Contribution</span>
                <strong>
                  {(split?.grossSats ?? contributionSats).toLocaleString()} sats
                </strong>
              </div>
              <div>
                <span>Question</span>
                <strong>{question.trim() ? "Attached" : "Optional"}</strong>
              </div>
              <div>
                <span>Network fee</span>
                <strong>Shown by wallet</strong>
              </div>
            </div>
            <div
              className={
                fundingBytes > MAX_DATA_CARRIER_BYTES
                  ? "counter bad"
                  : "counter"
              }
            >
              {fundingBytes.toLocaleString()} /{" "}
              {MAX_DATA_CARRIER_BYTES.toLocaleString()} OP_RETURN data-carrier
              bytes
            </div>
            <button
              className="primary"
              disabled={!canFundCampaign}
              type="submit"
            >
              <span className="button-content">
                <Send size={16} />
                <span>{busy ? "Funding" : "Fund Campaign"}</span>
              </span>
            </button>
            {!address ? (
              <p className="field-note">
                Connect UniSat to create or fund Pay2Speak campaigns.
              </p>
            ) : null}
          </form>
        </section>
      </div>

      <section className="id-launch-card">
        <div className="id-card-head">
          <div className="empty-icon" aria-hidden="true">
            <TrendingUp size={24} />
          </div>
          <div>
            <h3>Campaigns</h3>
            <p>
              Campaign ID is the creation txid. Pending records are visible;
              confirmed records are the durable source of truth.
            </p>
          </div>
        </div>
        <div className="id-record-list pay2speak-campaign-list">
          {campaigns.length === 0 ? (
            <div className="empty-state">
              <h3>No campaigns yet</h3>
              <p>Create the first Pay2Speak Space campaign on mainnet.</p>
            </div>
          ) : (
            campaigns.map((campaign) => (
              <article className="id-record" key={campaign.txid}>
                <div className="id-record-main">
                  <div>
                    <h4>{campaign.title}</h4>
                    <span>
                      {campaign.status} ·{" "}
                      {campaign.confirmed ? "Confirmed" : "Pending"} ·{" "}
                      {formatDate(campaign.createdAt)}
                    </span>
                  </div>
                  <strong>{pay2SpeakCampaignProgress(campaign)}%</strong>
                </div>
                <ProgressBar
                  label={`${campaign.title} funding progress`}
                  progress={pay2SpeakCampaignProgress(campaign)}
                />
                <dl className="activity-meta">
                  <div>
                    <dt>Gross</dt>
                    <dd>
                      {campaign.fundedGrossSats.toLocaleString()} /{" "}
                      {campaign.targetGrossSats.toLocaleString()}
                    </dd>
                  </div>
                  <div>
                    <dt>Creator</dt>
                    <dd>{shortAddress(campaign.creatorAddress)}</dd>
                  </div>
                  <div>
                    <dt>Funds</dt>
                    <dd>{campaign.fundingCount.toLocaleString()}</dd>
                  </div>
                </dl>
                <div className="id-record-actions">
                  <a
                    className="secondary small"
                    href={pay2SpeakCreatorUrl(campaign.creatorAddress)}
                  >
                    <span className="button-content">
                      <Mic2 size={15} />
                      <span>Creator Page</span>
                    </span>
                  </a>
                  <button
                    className="secondary small"
                    onClick={() => setSelectedCampaignId(campaign.txid)}
                    type="button"
                  >
                    <span className="button-content">
                      <MessageCircle size={15} />
                      <span>Fund</span>
                    </span>
                  </button>
                  <a
                    className="secondary small"
                    href={mempoolTxUrl(campaign.txid, campaign.network)}
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
            ))
          )}
        </div>
      </section>

      <section className="id-card">
        <div className="id-card-head">
          <div className="empty-icon" aria-hidden="true">
            <MessageSquareQuote size={24} />
          </div>
          <div>
            <h3>
              {selectedCampaign
                ? `${selectedCampaign.title} questions`
                : "Questions"}
            </h3>
            <p>Ranked by gross sats attached to valid funding transactions.</p>
          </div>
        </div>
        <div className="activity-feed">
          {campaignQuestions.length === 0 ? (
            <div className="empty-state">
              <h3>No questions yet</h3>
              <p>Fund a campaign with an optional question to add one.</p>
            </div>
          ) : (
            campaignQuestions.map((item) => (
              <article
                className="activity-row"
                key={`${item.txid}-${item.question}`}
              >
                <div className="activity-row-main">
                  <div>
                    <h4>{item.grossSats.toLocaleString()} sats</h4>
                    <strong>{item.question}</strong>
                  </div>
                  <time dateTime={item.createdAt}>
                    {formatDate(item.createdAt)}
                  </time>
                </div>
                <div className="id-record-actions">
                  <a
                    className="secondary small"
                    href={mempoolTxUrl(item.txid, "livenet")}
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
            ))
          )}
        </div>
      </section>
    </section>
  );
}
