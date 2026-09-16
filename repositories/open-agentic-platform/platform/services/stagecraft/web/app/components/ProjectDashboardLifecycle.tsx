// Spec 175 §2.1 (2) — lifecycle posture panel.
//
// Renders the project's spec-spine status × implementation breakdown.
// Reads from the dashboard snapshot's `lifecycle` panel; degrades to an
// empty-state with a CTA link to the Requirements decomposition flow
// (FR-008 / SC-006) when the project has no registry yet.

import { Link } from "react-router";
import type { LifecyclePanel } from "../../../api/projectDashboard/types";

interface Props {
  panel: LifecyclePanel;
  projectId: string;
}

const STATUS_LANES = ["draft", "approved", "superseded", "amended"] as const;
const IMPL_LANES = ["pending", "in-progress", "complete"] as const;

export function ProjectDashboardLifecycle({ panel, projectId }: Props) {
  if (!panel.available) {
    return (
      <PanelShell title="Lifecycle posture">
        <p className="text-sm text-amber-700 dark:text-amber-300">
          Lifecycle posture unavailable: {panel.reason}
        </p>
      </PanelShell>
    );
  }

  if (!panel.registryAvailable) {
    return (
      <PanelShell
        title="Lifecycle posture"
        action={
          <Link
            to={`/app/project/${projectId}/requirements`}
            className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            Run decomposition →
          </Link>
        }
      >
        <p className="text-sm text-gray-500 dark:text-gray-400">
          0 specs — this project has no spec spine yet. Decompose intent in
          the Requirements tab to populate the lifecycle board.
        </p>
      </PanelShell>
    );
  }

  const { counts } = panel;

  return (
    <PanelShell
      title="Lifecycle posture"
      subtitle={`${counts.total} spec${counts.total === 1 ? "" : "s"}`}
      action={
        <Link
          to={`/app/project/${projectId}/development`}
          className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          Open Development board →
        </Link>
      }
    >
      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
            Status
          </div>
          {STATUS_LANES.map((lane) => (
            <LaneRow
              key={lane}
              label={lane}
              count={counts.byStatus[lane] ?? 0}
            />
          ))}
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
            Implementation
          </div>
          {IMPL_LANES.map((lane) => (
            <LaneRow
              key={lane}
              label={lane}
              count={counts.byImplementation[lane] ?? 0}
            />
          ))}
        </div>
      </div>
    </PanelShell>
  );
}

function LaneRow({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-baseline justify-between text-sm py-0.5">
      <span className="text-gray-600 dark:text-gray-300">{label}</span>
      <span
        className={`font-mono ${count > 0 ? "text-gray-900 dark:text-gray-100" : "text-gray-400 dark:text-gray-500"}`}
      >
        {count}
      </span>
    </div>
  );
}

function PanelShell({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 p-4">
      <header className="flex items-baseline justify-between mb-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {title}
          </h2>
          {subtitle && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {subtitle}
            </span>
          )}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
