/**
 * Spec 123 §6.2 — Project-scoped agent bindings layout.
 *
 * Projects are consumers of the org agent catalog. The "Create draft" CTA
 * from the 119-era layout is removed; authoring lives at the org level
 * (/app/agents). This layout provides the breadcrumb chrome only.
 */

import { Outlet } from "react-router";
import { requireUser } from "../lib/auth.server";

export async function loader({ request }: { request: Request }) {
  await requireUser(request);
  return null;
}

export default function ProjectAgentsLayout() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Imported Agents
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Org agents imported into this project. Each binding pins a specific
          published version. To author or publish agents, visit the org-level{" "}
          <a
            href="/app/agents"
            className="text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            Agents
          </a>{" "}
          catalog.
        </p>
      </div>
      <Outlet />
    </div>
  );
}
