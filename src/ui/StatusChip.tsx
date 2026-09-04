import type { ReactNode } from "react";

export type StatusChipTone =
  | "default"
  | "good"
  | "pending"
  | "bad"
  | "info";

export function StatusChip({
  children,
  className = "",
  tone = "default",
}: {
  children: ReactNode;
  className?: string;
  tone?: StatusChipTone;
}) {
  return (
    <span
      className={["proof-status-chip", `is-${tone}`, className]
        .filter(Boolean)
        .join(" ")}
    >
      <span aria-hidden="true" className="proof-status-chip-dot" />
      {children}
    </span>
  );
}
