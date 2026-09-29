interface Props {
  lines?: number;
  label?: string;
}

export function Skeleton({ lines = 3, label = "Loading" }: Props) {
  return (
    <div className="skeleton" role="status" aria-label={label}>
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} className="skeleton-line" />
      ))}
    </div>
  );
}

const TONES: Record<string, string> = {
  allow: "ok",
  transform: "ok",
  healthy: "ok",
  available: "ok",
  ready: "ok",
  configured: "info",
  info: "info",
  approval: "warn",
  degraded: "warn",
  deny: "bad",
  unreachable: "bad",
  misconfigured: "bad",
  not_ready: "bad",
};

export function StatusBadge({ status, label }: { status?: string | null; label?: string }) {
  const value = status ?? "unknown";
  return (
    <span className={`badge ${TONES[value] ?? "info"}`}>{label ?? value.replace("_", " ")}</span>
  );
}
