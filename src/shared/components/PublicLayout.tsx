import type { ReactNode } from "react";

export function PublicPage({
  children,
  className = "",
  compact = false,
}: {
  children: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <section
      className={[
        "public-page",
        compact ? "public-page-compact" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </section>
  );
}

export function PublicPageHeader({
  actions,
  align = "center",
  children,
  className = "",
}: {
  actions?: ReactNode;
  align?: "center" | "start";
  children: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={[
        "public-page-header",
        align === "start" ? "align-start" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {actions ? <div className="public-page-header-actions">{actions}</div> : null}
      {children}
    </header>
  );
}

export function ResponsiveGrid({
  children,
  className = "",
  variant = "cards",
}: {
  children: ReactNode;
  className?: string;
  variant?: "cards" | "wide" | "tight";
}) {
  return (
    <div
      className={["responsive-grid", `responsive-grid-${variant}`, className]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}
export function DataList({
  items,
}: {
  items: Array<{ label: ReactNode; value: ReactNode }>;
}) {
  return (
    <div className="data-list">
      {items.map((item, index) => (
        <div className="data-row" key={index}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

export function ActionRow({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={["action-row", className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}

export function ProgressMeter({
  label,
  progress,
}: {
  label: string;
  progress: number;
}) {
  return (
    <div aria-label={label} className="progress-meter">
      <div
        style={{
          width: `${Math.max(0, Math.min(100, progress))}%`,
        }}
      />
    </div>
  );
}
