import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

export type AppStatusTone = "idle" | "good" | "bad";

export type AppStatusLink = {
  ariaLabel?: string;
  href: string;
  text: string;
  title?: string;
};

export type AppStatusState = {
  links?: AppStatusLink[];
  tone: AppStatusTone;
  text: string;
};

function renderStatusText(status: AppStatusState) {
  const links = (status.links ?? []).filter(
    (link) => link.text.trim() && link.href.trim(),
  );
  if (links.length === 0) {
    return status.text;
  }

  const parts: ReactNode[] = [];
  const unmatchedLinks: AppStatusLink[] = [];
  let cursor = 0;
  links.forEach((link) => {
    const start = status.text.indexOf(link.text, cursor);
    if (start === -1) {
      unmatchedLinks.push(link);
      return;
    }

    if (start > cursor) {
      parts.push(status.text.slice(cursor, start));
    }

    parts.push(
      <a
        aria-label={link.ariaLabel}
        className="status-link"
        href={link.href}
        key={`${link.href}-${start}`}
        rel="noreferrer"
        target="_blank"
        title={link.title}
      >
        {link.text}
      </a>,
    );
    cursor = start + link.text.length;
  });

  if (cursor < status.text.length) {
    parts.push(status.text.slice(cursor));
  }

  unmatchedLinks.forEach((link) => {
    parts.push(" ");
    parts.push(
      <a
        aria-label={link.ariaLabel}
        className="status-link"
        href={link.href}
        key={`${link.href}-unmatched`}
        rel="noreferrer"
        target="_blank"
        title={link.title}
      >
        {link.text}
      </a>,
    );
  });

  return parts;
}

export function AppStatusRow({
  className = "",
  persistent = false,
  secondaryStatus,
  status,
}: {
  className?: string;
  persistent?: boolean;
  secondaryStatus?: AppStatusState;
  status: AppStatusState;
}) {
  const [primaryExpanded, setPrimaryExpanded] = useState(false);
  const [secondaryExpanded, setSecondaryExpanded] = useState(false);
  const primaryTextId = useId();
  const secondaryTextId = useId();
  const showPrimary = persistent || status.tone !== "idle";
  const showSecondary = Boolean(secondaryStatus?.text.trim());
  if (!showPrimary && !showSecondary) {
    return null;
  }

  const statusLine = (
    lineStatus: AppStatusState,
    lineClassName = "",
    expanded = false,
    setExpanded?: (expanded: boolean) => void,
    textId = primaryTextId,
  ) => {
    const collapsible = lineStatus.text.trim().length > 72;
    return (
      <div
        className={[
          "status",
          lineClassName,
          lineStatus.tone,
          expanded ? "is-expanded" : "",
          collapsible ? "is-collapsible" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <span
          aria-atomic="true"
          aria-live={lineStatus.tone === "bad" ? "assertive" : "polite"}
          className="sr-only"
          role={lineStatus.tone === "bad" ? "alert" : "status"}
        >
          {lineStatus.text}
        </span>
        <span className="status-dot" aria-hidden="true" />
        <span className="status-text" id={textId}>
          {renderStatusText(lineStatus)}
        </span>
        {collapsible && setExpanded ? (
          <button
            aria-controls={textId}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse status" : "Show full status"}
            className="status-expand-button"
            onClick={() => setExpanded(!expanded)}
            type="button"
          >
            <ChevronDown aria-hidden="true" size={16} />
          </button>
        ) : null}
      </div>
    );
  };

  if (showSecondary && secondaryStatus) {
    return (
      <div
        className={["app-status-row", "app-status-stack", className]
          .filter(Boolean)
          .join(" ")}
      >
        {showPrimary
          ? statusLine(
              status,
              "app-status-primary",
              primaryExpanded,
              setPrimaryExpanded,
              primaryTextId,
            )
          : null}
        {statusLine(
          secondaryStatus,
          "app-status-degraded",
          secondaryExpanded,
          setSecondaryExpanded,
          secondaryTextId,
        )}
      </div>
    );
  }

  return statusLine(
    status,
    ["app-status-row", className].filter(Boolean).join(" "),
    primaryExpanded,
    setPrimaryExpanded,
    primaryTextId,
  );
}
