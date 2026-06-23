import {
  ArrowUpRight,
  AtSign,
  Clock,
  FilePenLine,
  FileText,
  Infinity as InfinityIcon,
  Mail,
  MessageSquareQuote,
  Monitor,
  RefreshCw,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import {
  BROWSER_APP_URL,
  COMPUTER_APP_URL,
  DESKTOP_APP_URL,
  GROWTH_APP_URL,
  ID_APP_URL,
  INFINITY_APP_URL,
  LOCAL_BROWSER_APP_URL,
  LOCAL_COMPUTER_APP_URL,
  LOCAL_DESKTOP_APP_URL,
  LOCAL_GROWTH_APP_URL,
  LOCAL_ID_APP_URL,
  LOCAL_INFINITY_APP_URL,
  LOCAL_LOG_APP_URL,
  LOCAL_MARKETPLACE_APP_URL,
  LOCAL_TOKEN_APP_URL,
  LOCAL_WALLET_APP_URL,
  LOCAL_WORK_TOKEN_APP_URL,
  LOG_APP_URL,
  MARKETPLACE_APP_URL,
  TOKEN_APP_URL,
  WALLET_APP_URL,
  WORK_TOKEN_APP_URL,
} from "../../app/appLinks";
import { appHref } from "../../app/routeRegistry";
import {
  explorerAddressUrl,
  explorerTxUrl,
} from "../../shared/bitcoin/networks";
import { AppHeader } from "../../shared/components/AppHeader";
import { AppStatusRow } from "../../shared/components/AppStatusRow";
import { SocialFooter } from "../../shared/components/SocialFooter";

type LandingRegistryRecord = {
  confirmed: boolean;
};

const LANDING_VIDEO_URL = "https://www.youtube.com/watch?v=vJLBCylKMyc";
const LANDING_VIDEO_EMBED_URL = "https://www.youtube.com/embed/vJLBCylKMyc";
const LANDING_TESTIMONIAL_TXID =
  "d9c41aef1e84a51bbc96fe81506f511cd9cead8ceaae8349f9f3f64bb50acd69";
const LANDING_TESTIMONIAL_TX_URL = explorerTxUrl(
  LANDING_TESTIMONIAL_TXID,
  "livenet",
);

function shortAddress(value: string) {
  if (!value) {
    return "Unknown";
  }

  return value.length > 18
    ? `${value.slice(0, 8)}...${value.slice(-8)}`
    : value;
}

export function LandingApp({
  registryAddress,
  registryRecords,
  onRefresh,
}: {
  registryAddress: string;
  registryRecords: LandingRegistryRecord[];
  onRefresh: () => void;
}) {
  const confirmedRecords = registryRecords.filter((record) => record.confirmed);
  const pendingRecords = registryRecords.filter((record) => !record.confirmed);

  return (
    <main className="landing-app">
      <AppHeader
        subtitle="The final network"
        title="ProofOfWork.Me"
      />
      <AppStatusRow persistent status={{ tone: "idle", text: "Ready" }} />

      <section className="landing-hero">
        <div className="landing-hero-content">
          <span className="landing-kicker">
            ProofOfWork-native identity, mail, files, pages, markets, credits,
            Infinity Bonds, logs, and growth
          </span>
          <h2>ProofOfWork.Me</h2>
          <p>
            Claim a permanent on-chain ID, then use the ProofOfWork Computer for
            mail, files, HTML pages, marketplace actions, credit mints, and
            bond-backed chain-readable proof.
          </p>
          <div className="landing-actions">
            <a
              className="primary link-button"
              href={appHref(ID_APP_URL, LOCAL_ID_APP_URL)}
            >
              <span className="button-content">
                <AtSign size={17} />
                <span>Claim an ID</span>
              </span>
            </a>
            <a
              className="secondary link-button"
              href={appHref(COMPUTER_APP_URL, LOCAL_COMPUTER_APP_URL)}
            >
              <span className="button-content">
                <Mail size={17} />
                <span>Open Computer</span>
              </span>
            </a>
            <a
              className="secondary link-button"
              href={appHref(DESKTOP_APP_URL, LOCAL_DESKTOP_APP_URL)}
            >
              <span className="button-content">
                <Monitor size={17} />
                <span>Open Desktop</span>
              </span>
            </a>
            <a
              className="secondary link-button"
              href={appHref(BROWSER_APP_URL, LOCAL_BROWSER_APP_URL)}
            >
              <span className="button-content">
                <FileText size={17} />
                <span>Open Browser</span>
              </span>
            </a>
            <a
              className="secondary link-button"
              href={appHref(MARKETPLACE_APP_URL, LOCAL_MARKETPLACE_APP_URL)}
            >
              <span className="button-content">
                <Users size={17} />
                <span>Marketplace</span>
              </span>
            </a>
            <a
              className="secondary link-button"
              href={appHref(TOKEN_APP_URL, LOCAL_TOKEN_APP_URL)}
            >
              <span className="button-content">
                <FilePenLine size={17} />
                <span>Credits</span>
              </span>
            </a>
            <a
              className="secondary link-button"
              href={appHref(WALLET_APP_URL, LOCAL_WALLET_APP_URL)}
            >
              <span className="button-content">
                <Wallet size={17} />
                <span>Wallet</span>
              </span>
            </a>
            <a
              className="secondary link-button"
              href={appHref(WORK_TOKEN_APP_URL, LOCAL_WORK_TOKEN_APP_URL)}
            >
              <span className="button-content">
                <TrendingUp size={17} />
                <span>WORK</span>
              </span>
            </a>
            <a
              className="secondary link-button"
              href={appHref(INFINITY_APP_URL, LOCAL_INFINITY_APP_URL)}
            >
              <span className="button-content">
                <InfinityIcon size={17} />
                <span>Infinity</span>
              </span>
            </a>
          </div>
        </div>
      </section>

      <section className="landing-main" aria-label="ProofOfWork.Me onboarding">
        <section
          className="landing-video"
          aria-label="ProofOfWork.Me overview video"
        >
          <div className="landing-video-copy">
            <span className="landing-kicker">Video overview</span>
            <h3>The ProofOfWork Computer is live</h3>
            <p>
              Watch the current walkthrough, then open the apps below and verify
              the records from ProofOfWork.
            </p>
            <a
              className="secondary link-button"
              href={LANDING_VIDEO_URL}
              rel="noreferrer"
              target="_blank"
            >
              <span className="button-content">
                <ArrowUpRight size={16} />
                <span>Open on YouTube</span>
              </span>
            </a>
          </div>
          <div className="landing-video-frame">
            <iframe
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              src={LANDING_VIDEO_EMBED_URL}
              title="ProofOfWork.Me ProofOfWork Computer overview"
            />
          </div>
        </section>

        <section className="landing-testimonial" aria-label="On-chain testimonial">
          <div className="empty-icon" aria-hidden="true">
            <MessageSquareQuote size={24} />
          </div>
          <div>
            <span className="landing-kicker">On-chain testimonial</span>
            <blockquote>
              "Truth above all else. We will not yield to foolish yet powerful
              tyrants for the true power resides with us. We need only converge
              on the truth."
            </blockquote>
            <p>
              Published to ProofOfWork through ProofOfWork.Me by D.D. Subject:{" "}
              <strong>Freedom and love</strong>.
            </p>
          </div>
          <a
            className="secondary link-button"
            href={LANDING_TESTIMONIAL_TX_URL}
            rel="noreferrer"
            target="_blank"
          >
            <span className="button-content">
              <ArrowUpRight size={16} />
              <span>View TX</span>
            </span>
          </a>
        </section>

        <section
          className="landing-stats"
          aria-label="ProofOfWork ID registry stats"
        >
          <div>
            <span>Confirmed IDs</span>
            <strong>{confirmedRecords.length.toLocaleString()}</strong>
          </div>
          <div>
            <span>Pending IDs</span>
            <strong>{pendingRecords.length.toLocaleString()}</strong>
          </div>
          <div>
            <span>Visible records</span>
            <strong>{registryRecords.length.toLocaleString()}</strong>
          </div>
          <button className="secondary" onClick={onRefresh} type="button">
            <span className="button-content">
              <RefreshCw size={16} />
              <span>Refresh Registry</span>
            </span>
          </button>
        </section>

        <section className="landing-choice-grid" aria-label="Choose an app">
          <article className="landing-choice">
            <div className="empty-icon" aria-hidden="true">
              <AtSign size={24} />
            </div>
            <div>
              <h3>Claim Your ID</h3>
              <p>
                Register <code>user@proofofwork.me</code> to your ProofOfWork
                receive address through the canonical mainnet registry.
              </p>
            </div>
            <a
              className="primary link-button"
              href={appHref(ID_APP_URL, LOCAL_ID_APP_URL)}
            >
              <span className="button-content">
                <AtSign size={16} />
                <span>Go to IDs</span>
              </span>
            </a>
          </article>

          <article className="landing-choice">
            <div className="empty-icon" aria-hidden="true">
              <Mail size={24} />
            </div>
            <div>
              <h3>Open Computer</h3>
              <p>
                Send and receive ProofOfWork-native mail, replies, and small files
                with local drafts, archive, favorites, and backups.
              </p>
            </div>
            <a
              className="secondary link-button"
              href={appHref(COMPUTER_APP_URL, LOCAL_COMPUTER_APP_URL)}
            >
              <span className="button-content">
                <Mail size={16} />
                <span>Open App</span>
              </span>
            </a>
          </article>

          <article className="landing-choice">
            <div className="empty-icon" aria-hidden="true">
              <Monitor size={24} />
            </div>
            <div>
              <h3>Open Desktop</h3>
              <p>
                Search an address or confirmed ProofOfWork ID and browse public
                confirmed files.
              </p>
            </div>
            <a
              className="secondary link-button"
              href={appHref(DESKTOP_APP_URL, LOCAL_DESKTOP_APP_URL)}
            >
              <span className="button-content">
                <Monitor size={16} />
                <span>Open Desktop</span>
              </span>
            </a>
          </article>

          <article className="landing-choice">
            <div className="empty-icon" aria-hidden="true">
              <FileText size={24} />
            </div>
            <div>
              <h3>Open Browser</h3>
              <p>
                Paste a txid and render HTML from ProofOfWork message bodies or
                verified <code>text/html</code> attachments.
              </p>
            </div>
            <a
              className="secondary link-button"
              href={appHref(BROWSER_APP_URL, LOCAL_BROWSER_APP_URL)}
            >
              <span className="button-content">
                <FileText size={16} />
                <span>Open Browser</span>
              </span>
            </a>
          </article>

          <article className="landing-choice">
            <div className="empty-icon" aria-hidden="true">
              <Users size={24} />
            </div>
            <div>
              <h3>Open Marketplace</h3>
              <p>
                List confirmed ProofOfWork IDs, delist them, and execute
                buyer-funded ownership transfers on chain.
              </p>
            </div>
            <a
              className="secondary link-button"
              href={appHref(MARKETPLACE_APP_URL, LOCAL_MARKETPLACE_APP_URL)}
            >
              <span className="button-content">
                <Users size={16} />
                <span>Open Marketplace</span>
              </span>
            </a>
          </article>

          <article className="landing-choice">
            <div className="empty-icon" aria-hidden="true">
              <FilePenLine size={24} />
            </div>
            <div>
              <h3>Create Credits</h3>
              <p>
                Launch mint-first <code>pwt1:</code> credits, set the owner
                registry, and let mints pay that registry directly.
              </p>
            </div>
            <a
              className="secondary link-button"
              href={appHref(TOKEN_APP_URL, LOCAL_TOKEN_APP_URL)}
            >
              <span className="button-content">
                <FilePenLine size={16} />
                <span>Open Credits</span>
              </span>
            </a>
          </article>

          <article className="landing-choice">
            <div className="empty-icon" aria-hidden="true">
              <Wallet size={24} />
            </div>
            <div>
              <h3>Open Wallet</h3>
              <p>
                Track confirmed platform credit balances and send{" "}
                <code>pwt1:send</code> transfers that pay the credit registry.
              </p>
            </div>
            <a
              className="secondary link-button"
              href={appHref(WALLET_APP_URL, LOCAL_WALLET_APP_URL)}
            >
              <span className="button-content">
                <Wallet size={16} />
                <span>Open Wallet</span>
              </span>
            </a>
          </article>

          <article className="landing-choice">
            <div className="empty-icon" aria-hidden="true">
              <TrendingUp size={24} />
            </div>
            <div>
              <h3>Track WORK</h3>
              <p>
                View the dedicated WORK dashboard, mint progress, holders,
                confirmed supply, and mint log.
              </p>
            </div>
            <a
              className="secondary link-button"
              href={appHref(WORK_TOKEN_APP_URL, LOCAL_WORK_TOKEN_APP_URL)}
            >
              <span className="button-content">
                <TrendingUp size={16} />
                <span>Open WORK</span>
              </span>
            </a>
          </article>

          <article className="landing-choice">
            <div className="empty-icon" aria-hidden="true">
              <InfinityIcon size={24} />
            </div>
            <div>
              <h3>Open Infinity</h3>
              <p>
                Create Infinity Bonds, track POWB supply and floor, and trade
                POWB through the same sale-ticket market as credits.
              </p>
            </div>
            <a
              className="secondary link-button"
              href={appHref(INFINITY_APP_URL, LOCAL_INFINITY_APP_URL)}
            >
              <span className="button-content">
                <InfinityIcon size={16} />
                <span>Open Infinity</span>
              </span>
            </a>
          </article>

          <article className="landing-choice">
            <div className="empty-icon" aria-hidden="true">
              <Clock size={24} />
            </div>
            <div>
              <h3>Open Log</h3>
              <p>
                Read the public ProofOfWork Computer activity feed for IDs, mail,
                replies, files, Browser pages, and marketplace events.
              </p>
            </div>
            <a
              className="secondary link-button"
              href={appHref(LOG_APP_URL, LOCAL_LOG_APP_URL)}
            >
              <span className="button-content">
                <Clock size={16} />
                <span>Open Log</span>
              </span>
            </a>
          </article>

          <article className="landing-choice">
            <div className="empty-icon" aria-hidden="true">
              <TrendingUp size={24} />
            </div>
            <div>
              <h3>Open Growth</h3>
              <p>
                Compare the canonical ProofOfWork Computer growth model against real
                confirmed network value in proofs and USD.
              </p>
            </div>
            <a
              className="secondary link-button"
              href={appHref(GROWTH_APP_URL, LOCAL_GROWTH_APP_URL)}
            >
              <span className="button-content">
                <TrendingUp size={16} />
                <span>Open Growth</span>
              </span>
            </a>
          </article>
        </section>

        <section className="landing-protocol">
          <div>
            <span className="landing-kicker">Canonical registry</span>
            <h3>{shortAddress(registryAddress)}</h3>
            <p>
              ProofOfWork IDs are resolved from ProofOfWork. First confirmed valid
              registration wins, and the app only routes mail to confirmed IDs.
            </p>
          </div>
          <a
            className="secondary link-button"
            href={explorerAddressUrl(registryAddress, "livenet")}
            rel="noreferrer"
            target="_blank"
          >
            <span className="button-content">
              <ArrowUpRight size={16} />
              <span>View Registry</span>
            </span>
          </a>
        </section>
      </section>

      <SocialFooter />
    </main>
  );
}
