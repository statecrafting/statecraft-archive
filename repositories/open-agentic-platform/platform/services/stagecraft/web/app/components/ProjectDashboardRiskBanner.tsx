// Spec 175 §2.1 (5), FR-006 — risk-banner panel.
//
// One of three severity levels: `ok` (no signals — banner suppressed),
// `warning` (1+ non-critical signals), `critical` (failed run in the
// last hour or tampered certificate). Banner shows the top-three
// contributing signals when severity is `warning` or `critical`.

import type { RiskPanel } from "../../../api/projectDashboard/types";

interface Props {
  panel: RiskPanel;
}

export function ProjectDashboardRiskBanner({ panel }: Props) {
  if (!panel.available) {
    return (
      <div className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
        Risk signals unavailable: {panel.reason}
      </div>
    );
  }
  if (panel.severity === "ok") {
    return (
      <div className="rounded-md border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 px-3 py-2 text-sm text-green-800 dark:text-green-300">
        <span className="font-medium">Healthy</span> — no risk signals.
      </div>
    );
  }

  const topSignals = panel.signals.slice(0, 3);
  const palette =
    panel.severity === "critical"
      ? "border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300"
      : "border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300";

  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${palette}`}>
      <div className="font-medium mb-1">
        {panel.severity === "critical" ? "Critical" : "Warning"} —{" "}
        {topSignals.length} signal{topSignals.length === 1 ? "" : "s"}
      </div>
      <ul className="list-disc list-inside space-y-0.5">
        {topSignals.map((s, i) => (
          <li key={`${s.kind}-${i}`}>{s.label}</li>
        ))}
      </ul>
    </div>
  );
}
