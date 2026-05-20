import { GitBranch, MessageCircle, X } from "lucide-react";
import {
  DISCORD_URL,
  GITHUB_URL,
  X_URL,
  YOUTUBE_URL,
} from "../../app/appLinks";
import { DomainNav } from "./DomainNav";

export function SocialFooter({ compact = false }: { compact?: boolean }) {
  return (
    <footer className={compact ? "app-footer compact" : "app-footer"}>
      <span>ProofOfWork.Me</span>
      <DomainNav compact={compact} />
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
        <a
          href={DISCORD_URL}
          rel="noreferrer"
          target="_blank"
          aria-label="ProofOfWork.Me Discord"
        >
          <span className="button-content">
            <MessageCircle size={14} />
            <span>Discord</span>
          </span>
        </a>
      </nav>
    </footer>
  );
}
