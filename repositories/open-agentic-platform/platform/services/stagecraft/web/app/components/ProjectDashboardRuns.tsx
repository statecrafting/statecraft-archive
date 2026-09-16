// Spec 175 §2.1 (4), FR-005 — recent factory runs panel.

import { Link } from "react-router";
import type { RunsPanel } from "../../../api/projectDashboard/types";

interface Props {
  panel: RunsPanel;
  projectId: string;
}

export function ProjectDashboardRuns({ panel, projectId }: Props) {
  if (!panel.available) {
    return (
      <PanelShell title="Recent factory runs">
        <p className="text-sm text-amber-700 dark:text-amber-300">
          Runs unavailable: {panel.reason}
        </p>
      </PanelShell>
    );
  }
  if (panel.runs.length === 0) {
    return (
      <PanelShell
        title="Recent factory runs"
        action={
          <Link
            to={`/app/project/${projectId}/development`}
            className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            Start a run →
          </Link>
        }
      >
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No factory runs recorded for this project yet.
        </p>
      </PanelShell>
    );
  }
  return (
    <PanelShell
      title="Recent factory runs"
      subtitle={`last ${panel.runs.length}`}
      action={
        <Link
          to={`/app/project/${projectId}/development`}
          className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          See all runs →
        </Link>
      }
    >
      <ul className="divide-y divide-gray-100 dark:divide-gray-800 -mx-1">
        {panel.runs.map((run) => (
          <li key={run.id} className="px-1 py-2 flex items-center gap-3 text-sm">
            <StatusDot status={run.status} />
            <Link
              to={`/app/factory/runs/${run.id}`}
              className="font-mono text-xs text-gray-700 dark:text-gray-300 hover:text-indigo-600 dark:hover:text-indigo-400"
            >
              {run.id.slice(0, 8)}…
            </Link>
            <span className="text-gray-600 dark:text-gray-300 flex-1 truncate">
              {run.currentStage ?? "—"}
            </span>
            <time
              dateTime={run.lastEventAt}
              className="text-xs text-gray-400 dark:text-gray-500"
              title={new Date(run.lastEventAt).toLocaleString()}
            >
              {ageLabel(run.lastEventAt)}
            </time>
          </li>
        ))}
      </ul>
    </PanelShell>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "ok"
      ? "bg-green-500"
      : status === "failed"
        ? "bg-red-500"
        : status === "cancelled"
          ? "bg-gray-400"
          : status === "running"
            ? "bg-blue-500"
            : "bg-amber-500";
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${color}`}
      title={status}
      aria-label={`status: ${status}`}
    />
  );
}

function ageLabel(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.max(1, Math.floor(diffMs / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
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
