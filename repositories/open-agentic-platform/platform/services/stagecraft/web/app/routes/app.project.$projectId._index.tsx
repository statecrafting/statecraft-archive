// Spec 175 — project dashboard (observability landing).
//
// Refines spec 087's project page from a six-tile nav grid into the
// AIDE `ProjectDetailView` analogue: six panels driven by a single
// `GET /api/projects/:projectId/dashboard` round-trip (FR-002 / SC-007).
//
// The six existing nav tiles are not removed — they live in a compact
// footer strip as a fallback navigation affordance (§2.2).

import { Link, useLoaderData, useOutletContext } from "react-router";
import { requireUser } from "../lib/auth.server";
import { getProjectDashboard } from "../lib/project-dashboard-api.server";
import type { ProjectDashboardSnapshot } from "../../../api/projectDashboard/types";
import { ProjectDashboardLifecycle } from "../components/ProjectDashboardLifecycle";
import { ProjectDashboardCertificate } from "../components/ProjectDashboardCertificate";
import { ProjectDashboardRuns } from "../components/ProjectDashboardRuns";
import { ProjectDashboardRiskBanner } from "../components/ProjectDashboardRiskBanner";
import { ProjectDashboardAudit } from "../components/ProjectDashboardAudit";

type ProjectCtx = {
  project: {
    id: string;
    name: string;
    slug: string;
    description?: string;
  };
};

interface LoaderData {
  snapshot: ProjectDashboardSnapshot | null;
  loadError: string | null;
}

export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { projectId: string };
}): Promise<LoaderData> {
  await requireUser(request);
  try {
    const snapshot = await getProjectDashboard(request, params.projectId);
    return { snapshot, loadError: null };
  } catch (err) {
    // The route MUST remain navigable even if the dashboard endpoint
    // fails (spec 175 §6 / FR-008). Surface the failure as a banner and
    // fall back to the legacy tile strip below.
    const message = err instanceof Error ? err.message : String(err);
    return { snapshot: null, loadError: message };
  }
}

export default function ProjectOverview() {
  const { project } = useOutletContext<ProjectCtx>();
  const { snapshot, loadError } = useLoaderData() as LoaderData;
  const base = `/app/project/${project.id}`;

  return (
    <div className="space-y-6">
      {loadError && (
        <div className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          Dashboard unavailable: {loadError}. Use the navigation tiles
          below.
        </div>
      )}

      {snapshot && (
        <>
          <ProjectDashboardRiskBanner panel={snapshot.risk} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ProjectDashboardLifecycle
              panel={snapshot.lifecycle}
              projectId={project.id}
            />
            <ProjectDashboardCertificate
              panel={snapshot.certificate}
              projectId={project.id}
            />
            <ProjectDashboardRuns
              panel={snapshot.runs}
              projectId={project.id}
            />
            <ProjectDashboardAudit panel={snapshot.audit} />
          </div>
        </>
      )}

      <FooterNavStrip base={base} />
    </div>
  );
}

// Spec 175 §2.2 — the original six-tile grid relegated to a compact
// link strip at the bottom of the dashboard. Fallback navigation
// affordance; not the primary surface area anymore.
function FooterNavStrip({ base }: { base: string }) {
  const tiles = [
    { to: `${base}/knowledge`, label: "Knowledge" },
    { to: `${base}/requirements`, label: "Requirements" },
    { to: `${base}/agents`, label: "Agents" },
    { to: `${base}/development`, label: "Development" },
    { to: `${base}/deploys`, label: "Deploys" },
    { to: `${base}/settings`, label: "Settings" },
  ];
  return (
    <nav
      aria-label="project sections"
      className="flex flex-wrap gap-2 pt-4 border-t border-gray-200 dark:border-gray-700"
    >
      {tiles.map((t) => (
        <Link
          key={t.to}
          to={t.to}
          className="text-xs px-2 py-1 rounded text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
