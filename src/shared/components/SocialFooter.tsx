import { GitBranch, X } from "lucide-react";
import { GITHUB_URL, HOME_APP_URL, LOCAL_HOME_APP_URL, X_URL, YOUTUBE_URL } from "../../app/appLinks";
import { appHref } from "../../app/routeRegistry";
import { DomainNav } from "./DomainNav";

export function SocialFooter({ compact = false, quiet = false }: { compact?: boolean; quiet?: boolean }) {
  return (
    <footer className={`app-footer${compact ? " compact" : ""}${quiet ? " boost-footer" : ""}`}>
      <a className="app-footer-brand" href={appHref(HOME_APP_URL, LOCAL_HOME_APP_URL)} aria-label="ProofOfWork.Me home">ProofOfWork.Me</a>
      <DomainNav placement="footer" />
      <nav className="social-nav" aria-label="Official ProofOfWork.Me links">
        <a
          href={X_URL}
          rel="noreferrer"
          target="_blank"
          aria-label="ProofOfWork.Me on X"
        >
          <span className="button-content">
            <X size={14} />
            <span>X</span>
          </span>
        </a>
        <a
          href={YOUTUBE_URL}
          rel="noreferrer"
          target="_blank"
          aria-label="ProofOfWork.Me on YouTube"
        >
          <span className="button-content">
            <span aria-hidden="true">YT</span>
            <span>YouTube</span>
          </span>
        </a>
        <a
          href={GITHUB_URL}
          rel="noreferrer"
          target="_blank"
          aria-label="ProofOfWork.Me on GitHub"
        >
          <span className="button-content">
            <GitBranch size={14} />
            <span>GitHub</span>
          </span>
        </a>
      </nav>
    </footer>
  );
}
