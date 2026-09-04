import {
  ArrowUpRight,
  AtSign,
  Clock,
  FilePenLine,
  FileText,
  GitBranch,
  Infinity as InfinityIcon,
  Mail,
  MessageSquareQuote,
  Monitor,
  RefreshCw,
  TrendingUp,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import {
  BOOST_APP_URL,
  BROWSER_APP_URL,
  COMPUTER_APP_URL,
  DESKTOP_APP_URL,
  GROWTH_APP_URL,
  ID_APP_URL,
  INCEPTION_APP_URL,
  INFINITY_APP_URL,
  LOCAL_BROWSER_APP_URL,
  LOCAL_BOOST_APP_URL,
  LOCAL_COMPUTER_APP_URL,
  LOCAL_DESKTOP_APP_URL,
  LOCAL_GROWTH_APP_URL,
  LOCAL_ID_APP_URL,
  LOCAL_INCEPTION_APP_URL,
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
import "./landing.css";

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

const LANDING_APP_GROUPS = [
  {
    description: "Communicate, publish, and inspect chain-readable work.",
    label: "Create & communicate",
    apps: [
      {
        description:
          "Mail, files, contacts, applications, and local-first account state in one sovereign workspace.",
        href: COMPUTER_APP_URL,
        icon: Mail,
        label: "Computer",
        localHref: LOCAL_COMPUTER_APP_URL,
      },
      {
        description:
          "Search a confirmed ID or address and browse its public, verified files.",
        href: DESKTOP_APP_URL,
        icon: Monitor,
        label: "Desktop",
        localHref: LOCAL_DESKTOP_APP_URL,
      },
      {
        description:
          "Render verified HTML messages and attachments from a transaction ID.",
        href: BROWSER_APP_URL,
        icon: FileText,
        label: "Browser",
        localHref: LOCAL_BROWSER_APP_URL,
      },
      {
        description:
          "Follow proof-ranked people and publish permanent social records from Mail.",
        href: BOOST_APP_URL,
        icon: Zap,
        label: "Boost",
        localHref: LOCAL_BOOST_APP_URL,
      },
    ],
  },
  {
    description: "Own an identity, then create and exchange verifiable value.",
    label: "Identity & markets",
    apps: [
      {
        description:
          "Claim a permanent ProofOfWork ID through the canonical registry.",
        href: ID_APP_URL,
        icon: AtSign,
        label: "IDs",
        localHref: LOCAL_ID_APP_URL,
      },
      {
        description:
          "Browse sealed terms and settle ID, credit, WORK, bond, and Boost sale tickets.",
        href: MARKETPLACE_APP_URL,
        icon: Users,
        label: "AMO",
        localHref: LOCAL_MARKETPLACE_APP_URL,
      },
      {
        description:
          "Create proof-backed credits and mint directly through their owner registries.",
        href: TOKEN_APP_URL,
        icon: FilePenLine,
        label: "Credits",
        localHref: LOCAL_TOKEN_APP_URL,
      },
      {
        description:
          "Review balances, transfer owned credits and bonds, and manage your sale tickets.",
        href: WALLET_APP_URL,
        icon: Wallet,
        label: "Wallet",
        localHref: LOCAL_WALLET_APP_URL,
      },
    ],
  },
  {
    description: "Read the instruments built from confirmed ProofOfWork state.",
    label: "Proof instruments",
    apps: [
      {
        description:
          "Inspect WORK supply, holders, network-value floor, AMO units, and confirmed history.",
        href: WORK_TOKEN_APP_URL,
        icon: TrendingUp,
        label: "WORK",
        localHref: LOCAL_WORK_TOKEN_APP_URL,
      },
      {
        description:
          "Create and inspect POWB Infinity Bonds and their sale-ticket market.",
        href: INFINITY_APP_URL,
        icon: InfinityIcon,
        label: "Infinity",
        localHref: LOCAL_INFINITY_APP_URL,
      },
      {
        description:
          "Create and inspect INCB Inception Bonds with frozen confirmation-time value.",
        href: INCEPTION_APP_URL,
        icon: GitBranch,
        label: "Inception",
        localHref: LOCAL_INCEPTION_APP_URL,
      },
    ],
  },
  {
    description: "Verify the public record and measure the Computer's growth.",
    label: "Observe & verify",
    apps: [
      {
        description:
          "Search the read-only activity ledger for chain-backed Computer events.",
        href: LOG_APP_URL,
        icon: Clock,
        label: "Log",
        localHref: LOCAL_LOG_APP_URL,
      },
      {
        description:
          "Compare canonical modeled value with confirmed network activity in proofs and USD.",
        href: GROWTH_APP_URL,
        icon: TrendingUp,
        label: "Growth",
        localHref: LOCAL_GROWTH_APP_URL,
      },
    ],
  },
] as const;

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
  registryError = "",
  registryFresh = false,
  registryLoaded = true,
  registryLoading = false,
  registryRecords,
  registryWarning = "",
  onRefresh,
}: {
  registryAddress: string;
  registryError?: string;
  registryFresh?: boolean;
  registryLoaded?: boolean;
  registryLoading?: boolean;
  registryRecords: LandingRegistryRecord[];
  registryWarning?: string;
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
      <AppStatusRow
        persistent
        secondaryStatus={
          registryWarning
            ? { tone: "idle", text: registryWarning }
            : undefined
        }
        status={
          registryLoading
            ? {
                tone: "idle",
                text: registryLoaded
                  ? "Refreshing the ID registry through the full node..."
                  : "Loading the indexed ProofOfWork ID registry summary...",
              }
            : registryError
              ? { tone: "bad", text: registryError }
              : registryLoaded
                ? {
                    tone: registryFresh ? "good" : "idle",
                    text: registryFresh
                      ? "Full-node ProofOfWork ID registry summary verified."
                      : "Verified last-good ProofOfWork ID registry summary loaded. This view is not current until an exact-tip refresh succeeds.",
                  }
                : {
                    tone: "idle",
                    text: "ProofOfWork ID registry summary has not loaded yet.",
                  }
        }
      />

      <section className="landing-hero">
        <div className="landing-hero-content">
          <div className="landing-hero-copy">
            <span className="landing-kicker">The ProofOfWork Computer</span>
            <h2>ProofOfWork.Me</h2>
            <p>
              Claim a permanent on-chain ID, then communicate, publish, exchange,
              and verify through one chain-readable computer.
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
                className="secondary link-button landing-computer-action"
                href={appHref(COMPUTER_APP_URL, LOCAL_COMPUTER_APP_URL)}
              >
                <span className="button-content">
                  <Mail size={17} />
                  <span>Open Computer</span>
                </span>
              </a>
            </div>
          </div>
          <aside className="landing-hero-instrument" aria-label="Core guarantees">
            <div className="landing-instrument-head">
              <span>Proof instrument</span>
              <strong>Live</strong>
            </div>
            <dl>
              <div>
                <dt>Source</dt>
                <dd>Confirmed ProofOfWork</dd>
              </div>
              <div>
                <dt>Signing</dt>
                <dd>Local wallet</dd>
              </div>
              <div>
                <dt>Records</dt>
                <dd>Human-readable · agent-verifiable</dd>
              </div>
            </dl>
            <span className="landing-instrument-foot">
              Pending data is visibility. Confirmation is truth.
            </span>
          </aside>
        </div>
      </section>

      <section className="landing-main" aria-label="ProofOfWork.Me onboarding">
        <section
          className="landing-stats"
          aria-label="ProofOfWork ID registry stats"
        >
          <div>
            <span>Confirmed IDs</span>
            <strong>
              {registryLoaded ? confirmedRecords.length.toLocaleString() : "…"}
            </strong>
          </div>
          <div>
            <span>Pending IDs</span>
            <strong>
              {registryLoaded ? pendingRecords.length.toLocaleString() : "…"}
            </strong>
          </div>
          <div>
            <span>Visible records</span>
            <strong>
              {registryLoaded ? registryRecords.length.toLocaleString() : "…"}
            </strong>
          </div>
          <button
            className="secondary"
            disabled={registryLoading}
            onClick={onRefresh}
            type="button"
          >
            <span className="button-content">
              <RefreshCw size={16} />
              <span>{registryLoading ? "Refreshing" : "Refresh Registry"}</span>
            </span>
          </button>
        </section>

        <section className="landing-explore" aria-labelledby="landing-explore-title">
          <header className="landing-section-heading">
            <span className="landing-kicker">Apparatus</span>
            <h2 id="landing-explore-title">Explore the Computer</h2>
            <p>
              Start with a task. Every surface resolves back to the same
              chain-readable record.
            </p>
          </header>

          <div className="landing-app-groups">
            {LANDING_APP_GROUPS.map((group, groupIndex) => (
              <section
                className="landing-app-group"
                key={group.label}
                aria-labelledby={`landing-app-group-${groupIndex}`}
              >
                <header>
                  <span>{String(groupIndex + 1).padStart(2, "0")}</span>
                  <div>
                    <h3 id={`landing-app-group-${groupIndex}`}>{group.label}</h3>
                    <p>{group.description}</p>
                  </div>
                </header>
                <div className="landing-app-grid">
                  {group.apps.map((app) => {
                    const AppIcon = app.icon;
                    return (
                      <a
                        className="landing-app-card"
                        href={appHref(app.href, app.localHref)}
                        key={app.label}
                      >
                        <span className="landing-app-icon" aria-hidden="true">
                          <AppIcon size={20} />
                        </span>
                        <span className="landing-app-copy">
                          <strong>{app.label}</strong>
                          <span>{app.description}</span>
                        </span>
                        <ArrowUpRight
                          className="landing-app-arrow"
                          size={17}
                          aria-hidden="true"
                        />
                      </a>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </section>

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
