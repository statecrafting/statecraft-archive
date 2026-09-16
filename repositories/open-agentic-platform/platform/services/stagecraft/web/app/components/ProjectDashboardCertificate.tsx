// Spec 175 §2.1 (3), FR-004 — recent governance certificate panel.
//
// The dashboard surfaces the last-known certificate state; it never
// re-runs the verifier on load. For projects without any completed
// factory run, an empty state explains the missing emission.

import { Link } from "react-router";
import type { CertificatePanel } from "../../../api/projectDashboard/types";

interface Props {
  panel: CertificatePanel;
  projectId: string;
}

export function ProjectDashboardCertificate({ panel, projectId }: Props) {
  if (!panel.available) {
    return (
      <PanelShell title="Recent governance certificate">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {panel.reason || "No certificate yet."}
        </p>
      </PanelShell>
    );
  }

  return (
    <PanelShell
      title="Recent governance certificate"
      action={
        <Link
          to={`/app/project/${projectId}/development`}
          className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          Open run →
        </Link>
      }
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-gray-500 dark:text-gray-400">Emitted</dt>
        <dd className="text-gray-900 dark:text-gray-100">
          <time dateTime={panel.emittedAt}>{formatTimestamp(panel.emittedAt)}</time>
        </dd>
        <dt className="text-gray-500 dark:text-gray-400">Run</dt>
        <dd className="font-mono text-xs text-gray-700 dark:text-gray-300">
          {panel.runId.slice(0, 8)}…
        </dd>
        <dt className="text-gray-500 dark:text-gray-400">Hash</dt>
        <dd className="font-mono text-xs text-gray-700 dark:text-gray-300">
          {panel.hashPrefix ?? "—"}
        </dd>
        <dt className="text-gray-500 dark:text-gray-400">Verifier</dt>
        <dd>
          <VerifierBadge status={panel.verifierStatus} />
        </dd>
      </dl>
    </PanelShell>
  );
}

function VerifierBadge({
  status,
}: {
  status: "clean" | "tampered" | "not-yet-verified";
}) {
  const styles: Record<typeof status, string> = {
    clean:
      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    tampered:
      "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    "not-yet-verified":
      "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${styles[status]}`}
    >
      {status === "not-yet-verified" ? "not yet verified" : status}
    </span>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

function PanelShell({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 p-4">
      <header className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {title}
        </h2>
        {action}
      </header>
      {children}
    </section>
  );
}
