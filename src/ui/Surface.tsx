import type { ReactNode } from "react";

export function Surface({
  children,
  className = "",
  level = "raised",
}: {
  children: ReactNode;
  className?: string;
  level?: "base" | "raised" | "inset";
}) {
  return (
    <section
      className={["proof-surface", `is-${level}`, className]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </section>
  );
}

export function Toolbar({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={["proof-toolbar", className].filter(Boolean).join(" ")}
      role="toolbar"
    >
      {children}
    </div>
  );
}
