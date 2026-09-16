/**
 * Spec 123 — Org-scoped agent catalog layout.
 *
 * Top-nav surface for the org agent catalog. Sits between Projects and
 * Factory in the nav (spec 123 §6.1). Authoring, version history,
 * publish/retire, and governance all live here. Projects consume via
 * bindings (spec 123 §6.2).
 */

import { Outlet } from "react-router";
import { requireUser } from "../lib/auth.server";

export async function loader({ request }: { request: Request }) {
  await requireUser(request);
  return null;
}

export default function AgentsLayout() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          Agents
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Org-level agent catalog. Drafts, publish, retire, and fork governed
          agent definitions. Projects bind to specific versions.
        </p>
      </div>
      <Outlet />
    </div>
  );
}
