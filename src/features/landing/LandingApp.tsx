import {
  ArrowUpRight,
  AtSign,
  Clock,
  Code2,
  CheckSquare,
  FilePenLine,
  FileText,
  GitBranch,
  Globe2,
  Infinity as InfinityIcon,
  Mail,
  MessageSquareQuote,
  Monitor,
  PanelsTopLeft,
  Play,
  RefreshCw,
  Search,
  TrendingUp,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import { useState } from "react";
import {
  BOOST_APP_URL,
  PUBLISH_APP_URL,
  SEARCH_APP_URL,
  CODE_APP_URL,
  JOBS_APP_URL,
  BROWSER_APP_URL,
  COMPUTER_APP_URL,
  DESKTOP_APP_URL,
  DNS_APP_URL,
  GROWTH_APP_URL,
  ID_APP_URL,
  INCEPTION_APP_URL,
  INFINITY_APP_URL,
  LOCAL_BROWSER_APP_URL,
  LOCAL_BOOST_APP_URL,
  LOCAL_PUBLISH_APP_URL,
  LOCAL_SEARCH_APP_URL,
  LOCAL_CODE_APP_URL,
  LOCAL_JOBS_APP_URL,
  LOCAL_COMPUTER_APP_URL,
  LOCAL_DESKTOP_APP_URL,
  LOCAL_DNS_APP_URL,
  LOCAL_GROWTH_APP_URL,
  LOCAL_ID_APP_URL,
  LOCAL_INCEPTION_APP_URL,
  LOCAL_INFINITY_APP_URL,
  LOCAL_LOG_APP_URL,
  LOCAL_MARKETPLACE_APP_URL,
  LOCAL_PAGES_APP_URL,
  LOCAL_TOKEN_APP_URL,
  LOCAL_WALLET_APP_URL,
  LOCAL_WORK_TOKEN_APP_URL,
  LOG_APP_URL,
  MARKETPLACE_APP_URL,
  PAGES_APP_URL,
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
import CodeActivitySummary from "../growth/CodeActivitySummary";
import JobsActivitySummary from "../growth/JobsActivitySummary";
import "./landing.css";

type LandingRegistryCounts = {
  confirmedCount: number;
  pendingCount: number;
  totalCount: number;
};

const EMPTY_REGISTRY_COUNTS: LandingRegistryCounts = {
  confirmedCount: 0,
  pendingCount: 0,
  totalCount: 0,
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
          "Create HTML pages and apps, preview locally, and publish through Files and Mail.",
        href: PAGES_APP_URL,
        icon: PanelsTopLeft,
        label: "Pages",
        localHref: LOCAL_PAGES_APP_URL,
      },
      {
        description:
          "Follow proof-ranked people and publish permanent social records from Mail.",
        href: BOOST_APP_URL,
        icon: Zap,
        label: "Boost",
        localHref: LOCAL_BOOST_APP_URL,
      },
      {
        description:
          "Publish complete text articles with a shared PowID and Boost replies, likes, and reboosts.",
        href: PUBLISH_APP_URL,
        icon: FilePenLine,
        label: "Publish",
        localHref: LOCAL_PUBLISH_APP_URL,
      },
      {
        description: "Search Computer protocols, public content, files, and transaction evidence.",
        href: SEARCH_APP_URL,
        icon: Search,
        label: "Search",
        localHref: LOCAL_SEARCH_APP_URL,
      },
      {
        description: "Publish source files in wallet-owned repositories with verifiable on-chain revision history.",
        href: CODE_APP_URL,
        icon: Code2,
        label: "Code",
        localHref: LOCAL_CODE_APP_URL,
      },
      {
        description: "Commission work, deliver evidence, and pay in proofs with an inspectable public receipt.",
        href: JOBS_APP_URL, icon: CheckSquare, label: "Jobs", localHref: LOCAL_JOBS_APP_URL,
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
          "Claim and search a permanent .pow DNS name from the canonical registry.",
        href: DNS_APP_URL,
        icon: Globe2,
        label: "DNS",
        localHref: LOCAL_DNS_APP_URL,
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
  dnsRegistryAddress,
  dnsRegistryCounts = EMPTY_REGISTRY_COUNTS,
  dnsRegistryError = "",
  dnsRegistryFresh = false,
  dnsRegistryLoaded = false,
  dnsRegistryLoading = false,
  dnsRegistryWarning = "",
  registryAddress,
  registryError = "",
  registryFresh = false,
  registryLoaded = true,
  registryLoading = false,
  registryCounts,
  registryWarning = "",
  onRefresh,
}: {
  dnsRegistryAddress: string;
  dnsRegistryCounts?: LandingRegistryCounts;
  dnsRegistryError?: string;
  dnsRegistryFresh?: boolean;
  dnsRegistryLoaded?: boolean;
  dnsRegistryLoading?: boolean;
  dnsRegistryWarning?: string;
  registryAddress: string;
  registryError?: string;
  registryFresh?: boolean;
  registryLoaded?: boolean;
  registryLoading?: boolean;
  registryCounts: LandingRegistryCounts;
  registryWarning?: string;
  onRefresh: () => void;
}) {
  const [videoLoaded, setVideoLoaded] = useState(false);
  const registriesLoaded = registryLoaded && dnsRegistryLoaded;
  const registriesLoading = registryLoading || dnsRegistryLoading;
  const registriesFresh = registryFresh && dnsRegistryFresh;
  const registryStatusText = [registryError, dnsRegistryError]
    .filter(Boolean)
    .join(" ");
  const registryWarningText = [registryWarning, dnsRegistryWarning]
    .filter(Boolean)
    .join(" ");
  const registryStatValue = (loaded: boolean, value: number) =>
    loaded ? value.toLocaleString() : "…";

  return (
    <main className="landing-app">
      <AppHeader
        subtitle="The final network"
        title="ProofOfWork.Me"
      />
      <AppStatusRow
        persistent
        secondaryStatus={
          registryWarningText
            ? { tone: "idle", text: registryWarningText }
            : undefined
        }
        status={
          registriesLoading
            ? {
                tone: "idle",
                text: registriesLoaded
                  ? "Refreshing the ID and DNS registries through the full node..."
                  : "Loading the indexed ProofOfWork ID and DNS registry summaries...",
              }
            : registryStatusText
              ? { tone: "bad", text: registryStatusText }
              : registriesLoaded
                ? {
                    tone: registriesFresh ? "good" : "idle",
                    text: registriesFresh
                      ? "Full-node ProofOfWork ID and DNS registry summaries verified."
                      : "Verified last-good ProofOfWork ID and DNS registry summaries loaded. This view is not current until an exact-tip refresh succeeds.",
                  }
                : {
                    tone: "idle",
                    text: "ProofOfWork ID and DNS registry summaries have not loaded yet.",
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
                className="primary link-button"
                href={appHref(DNS_APP_URL, LOCAL_DNS_APP_URL)}
              >
                <span className="button-content">
                  <Globe2 size={17} />
                  <span>Claim DNS</span>
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
          aria-label="ProofOfWork ID and DNS registry stats"
        >
          <div>
            <span>Confirmed IDs</span>
            <strong>{registryStatValue(registryLoaded, registryCounts.confirmedCount)}</strong>
          </div>
          <div>
            <span>Pending IDs</span>
            <strong>{registryStatValue(registryLoaded, registryCounts.pendingCount)}</strong>
          </div>
          <div>
            <span>ID records</span>
            <strong>{registryStatValue(registryLoaded, registryCounts.totalCount)}</strong>
          </div>
          <div>
            <span>Confirmed .pow</span>
            <strong>{registryStatValue(dnsRegistryLoaded, dnsRegistryCounts.confirmedCount)}</strong>
          </div>
          <div>
            <span>Pending .pow</span>
            <strong>{registryStatValue(dnsRegistryLoaded, dnsRegistryCounts.pendingCount)}</strong>
          </div>
          <div>
            <span>DNS records</span>
            <strong>{registryStatValue(dnsRegistryLoaded, dnsRegistryCounts.totalCount)}</strong>
          </div>
          <button
            className="secondary"
            disabled={registriesLoading}
            onClick={onRefresh}
            type="button"
          >
            <span className="button-content">
              <RefreshCw size={16} />
              <span>{registriesLoading ? "Refreshing" : "Refresh Registries"}</span>
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
          <section aria-label="Jobs activity">
            <h3>Work on chain</h3>
            <JobsActivitySummary network="livenet" refreshing={registryLoading || dnsRegistryLoading} />
          </section>
          <section aria-label="Code activity">
            <h3>Code on chain</h3>
            <CodeActivitySummary network="livenet" refreshing={registryLoading || dnsRegistryLoading} />
          </section>
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
            {videoLoaded ? (
              <iframe
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
                src={LANDING_VIDEO_EMBED_URL}
                title="ProofOfWork.Me ProofOfWork Computer overview"
              />
            ) : (
              <button
                aria-label="Load the ProofOfWork Computer overview video from YouTube"
                className="landing-video-load"
                onClick={() => setVideoLoaded(true)}
                type="button"
              >
                <Play aria-hidden="true" fill="currentColor" size={22} />
                <span>Load video from YouTube</span>
              </button>
            )}
          </div>
        </section>

        <section className="landing-testimonial" aria-label="On-chain testimonial">
          <div className="empty-icon" aria-hidden="true">
            <MessageSquareQuote size={24} />
          </div>
          <div>
            <span className="landing-kicker">On-chain testimonial</span>
            <blockquote>
              "Truth above all else. […] We will not yield to foolish yet powerful
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
            <span className="landing-kicker">Canonical registries</span>
            <h3>
              {shortAddress(registryAddress)} · {shortAddress(dnsRegistryAddress)}
            </h3>
            <p>
              ProofOfWork IDs and .pow DNS names are resolved from ProofOfWork.
              First confirmed valid registration wins, and apps only route to
              confirmed records.
            </p>
          </div>
          <div className="landing-protocol-actions">
            <a
              className="secondary link-button"
              href={explorerAddressUrl(registryAddress, "livenet")}
              rel="noreferrer"
              target="_blank"
            >
              <span className="button-content">
                <ArrowUpRight size={16} />
                <span>View ID Registry</span>
              </span>
            </a>
            <a
              className="secondary link-button"
              href={explorerAddressUrl(dnsRegistryAddress, "livenet")}
              rel="noreferrer"
              target="_blank"
            >
              <span className="button-content">
                <ArrowUpRight size={16} />
                <span>View DNS Registry</span>
              </span>
            </a>
          </div>
        </section>
      </section>

      <SocialFooter />
    </main>
  );
}
