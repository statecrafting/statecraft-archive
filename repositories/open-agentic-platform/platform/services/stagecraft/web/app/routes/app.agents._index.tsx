/**
 * Spec 123 — Org-scoped agent catalog list view.
 *
 * Status-tabbed listing (draft / published / retired / all) with client-side
 * search over name and tags. Clicking a row navigates to the detail view.
 * "New draft" opens the creation form. orgId comes from the JWT claims via
 * `requireUser`.
 */

import { Link, useLoaderData } from "react-router";
import { requireUser } from "../lib/auth.server";
import { listOrgAgents, type OrgCatalogAgent } from "../lib/agents-api.server";
import type { AgentCatalogStatus } from "../lib/agents-api.server";
import { useMemo, useState } from "react";

type StatusFilter = AgentCatalogStatus | "all";
const STATUSES: StatusFilter[] = ["all", "draft", "published", "retired"];

const STATUS_COLORS: Record<AgentCatalogStatus, string> = {
  draft:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  published:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  retired:
    "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
};

export async function loader({ request }: { request: Request }) {
  const user = await requireUser(request);
  // Fetch every status so the status-count badges are live without a refetch
  // per tab change. Server-side limit (500) applies.
  const { agents } = await listOrgAgents(request, user.orgId);
  return { agents };
}

export default function OrgAgentCatalogIndex() {
  const { agents } = useLoaderData() as { agents: OrgCatalogAgent[] };
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    const out: Record<StatusFilter, number> = {
      all: agents.length,
      draft: 0,
      published: 0,
      retired: 0,
    };
    for (const a of agents) out[a.status] += 1;
    return out;
  }, [agents]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return agents.filter((a) => {
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      if (!q) return true;
      if (a.name.toLowerCase().includes(q)) return true;
      const tags = a.frontmatter.tags ?? [];
      return tags.some((t) => t.toLowerCase().includes(q));
    });
  }, [agents, statusFilter, query]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 flex-1">
          {STATUSES.map((s) => {
            const active = statusFilter === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                  active
                    ? "border-indigo-500 text-indigo-600 dark:text-indigo-400"
                    : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
                }`}
              >
                {s}
                <span className="ml-1 text-xs text-gray-400">
                  ({counts[s]})
                </span>
              </button>
            );
          })}
        </div>
        <Link
          to="/app/agents/new"
          className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          New draft
        </Link>
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name or tag"
        className="block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
      />

      {filtered.length === 0 ? (
        <div className="border border-dashed border-gray-300 dark:border-gray-600 rounded-lg px-4 py-12 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
            No agents
            {statusFilter !== "all" ? ` in "${statusFilter}" state` : ""}
            {query ? ` matching "${query}"` : ""}.
          </p>
          {agents.length === 0 && (
            <p className="text-sm text-gray-400 dark:text-gray-500">
              Create a draft to add an agent to the org catalog.
            </p>
          )}
        </div>
      ) : (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <Th>Name</Th>
                <Th>Version</Th>
                <Th>Status</Th>
                <Th>Type</Th>
                <Th>Tier</Th>
                <Th>Tags</Th>
                <Th>Updated</Th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
              {filtered.map((a) => (
                <tr
                  key={a.id}
                  className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link
                      to={`/app/agents/${a.id}`}
                      className="text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-indigo-600 dark:hover:text-indigo-400 font-mono"
                    >
                      {a.name}
                    </Link>
                    {a.frontmatter.display_name && (
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {a.frontmatter.display_name}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    v{a.version}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[a.status]}`}
                    >
                      {a.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    {a.frontmatter.type}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    {a.frontmatter.safety_tier ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    {(a.frontmatter.tags ?? []).join(", ") || "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    {new Date(a.updated_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
      {children}
    </th>
  );
}
