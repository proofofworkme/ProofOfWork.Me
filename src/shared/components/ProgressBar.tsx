export function ProgressBar({
  label,
  progress,
}: {
  label: string;
  progress: number;
}) {
  return (
    <div
      aria-label={label}
      style={{
        background: "var(--surface-soft)",
        border: "1px solid var(--border)",
        borderRadius: 999,
        height: 10,
        overflow: "hidden",
      }}
    >
      <span
        style={{
          background: "linear-gradient(90deg, var(--accent), var(--green))",
          display: "block",
          height: "100%",
          minWidth: 2,
          width: `${Math.max(0, Math.min(100, progress))}%`,
        }}
      />
    </div>
  );
}
