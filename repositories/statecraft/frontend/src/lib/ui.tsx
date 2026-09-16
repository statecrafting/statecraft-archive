/** Small presentational helpers shared across routes (dependency-light). */

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

// Maps a backend status string (installation / stamp / fleet) to a visual tone.
const STATUS_TONE: Record<string, string> = {
  green: "ok",
  running: "ok",
  active: "ok",
  failed: "bad",
  removed: "bad",
  suspended: "warn",
  queued: "muted",
  stamping: "busy",
  pushing: "busy",
  verifying: "busy",
  placing: "busy",
  updating: "busy",
};

export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? "muted";
  return <span className={`badge badge-${tone}`}>{status}</span>;
}
