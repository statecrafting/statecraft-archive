// Spec 175 §2.1 (6), FR-007 — audit summary panel.

import type { AuditPanel } from "../../../api/projectDashboard/types";

interface Props {
  panel: AuditPanel;
}

export function ProjectDashboardAudit({ panel }: Props) {
  if (!panel.available) {
    return (
      <PanelShell title="Audit summary">
        <p className="text-sm text-amber-700 dark:text-amber-300">
          Audit unavailable: {panel.reason}
        </p>
      </PanelShell>
    );
  }
  if (panel.rows.length === 0) {
    return (
      <PanelShell title="Audit summary">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No audit events recorded for this project yet.
        </p>
      </PanelShell>
    );
  }
  return (
    <PanelShell title="Audit summary" subtitle={`last ${panel.rows.length}`}>
      <ul className="divide-y divide-gray-100 dark:divide-gray-800 -mx-1">
        {panel.rows.map((row) => (
          <li
            key={row.id}
            className="px-1 py-2 grid grid-cols-[1fr_auto] gap-x-2 text-sm"
          >
            <div className="min-w-0">
              <div className="font-mono text-xs text-gray-700 dark:text-gray-300 truncate">
                {row.action}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {row.targetType}:{row.targetId.slice(0, 8)}… ·{" "}
                <AuthSourceBadge source={row.authSource} />
              </div>
            </div>
            <time
              dateTime={row.createdAt}
              className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap"
              title={new Date(row.createdAt).toLocaleString()}
            >
              {ageLabel(row.createdAt)}
            </time>
          </li>
        ))}
      </ul>
    </PanelShell>
  );
}

function AuthSourceBadge({
  source,
}: {
  source: "session" | "api_key" | "m2m" | "unknown";
}) {
  if (source === "unknown") return <span className="text-gray-400">—</span>;
  const styles =
    source === "session"
      ? "text-indigo-700 dark:text-indigo-300"
      : source === "api_key"
        ? "text-purple-700 dark:text-purple-300"
        : "text-teal-700 dark:text-teal-300";
  return <span className={`uppercase ${styles}`}>{source}</span>;
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
  children,
}: {
  title: string;
  subtitle?: string;
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
      </header>
      {children}
    </section>
  );
}
