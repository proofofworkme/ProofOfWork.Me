import { GitBranch, X } from "lucide-react";
import { APP_LINKS, GITHUB_URL, X_URL, YOUTUBE_URL } from "../../app/appLinks";
import { appHref } from "../../app/routeRegistry";

export function SocialFooter({ compact = false }: { compact?: boolean }) {
  return (
    <footer className={compact ? "app-footer compact" : "app-footer"}>
      <span className="app-footer-brand">ProofOfWork.Me</span>
      <nav className="footer-app-nav" aria-label="ProofOfWork.Me app links">
        {APP_LINKS.map((link) => (
          <a href={appHref(link.href, link.localHref)} key={link.href}>
            {link.label}
          </a>
        ))}
      </nav>
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
