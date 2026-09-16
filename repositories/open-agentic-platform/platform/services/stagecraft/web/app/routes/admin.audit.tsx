import { useLoaderData, useSearchParams, Link } from "react-router";
import { createEncoreClient } from "../lib/encore.server";
import { requireAdmin } from "../lib/auth.server";

export async function loader({ request }: { request: Request }) {
  await requireAdmin(request);
  const url = new URL(request.url);
  const client = createEncoreClient(request);

  const params: Record<string, string | number> = {};
  const cursor = url.searchParams.get("cursor");
  const action = url.searchParams.get("action");
  const actorUserId = url.searchParams.get("actorUserId");
  const targetType = url.searchParams.get("targetType");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  if (cursor) params.cursor = cursor;
  if (action) params.action = action;
  if (actorUserId) params.actorUserId = actorUserId;
  if (targetType) params.targetType = targetType;
  if (from) params.from = from;
  if (to) params.to = to;
  params.limit = 50;

  const res = await client.admin.listAudit(params);
  return {
    events: res.events,
    nextCursor: res.nextCursor,
    filters: { action, actorUserId, targetType, from, to },
  };
}

export default function AdminAudit() {
  const { events, nextCursor, filters } = useLoaderData() as {
    events: Array<{
      id: string;
      actorUserId: string;
      action: string;
      targetType: string;
      targetId: string;
      metadata: Record<string, unknown>;
      createdAt: string;
    }>;
    nextCursor?: string;
    filters: Record<string, string | null>;
  };

  const [searchParams] = useSearchParams();

  function buildUrl(overrides: Record<string, string | undefined>) {
    const p = new URLSearchParams();
    // Preserve existing filters
    for (const [k, v] of Object.entries(filters)) {
      if (v) p.set(k, v);
    }
    // Apply overrides
    for (const [k, v] of Object.entries(overrides)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    return `/admin/audit?${p.toString()}`;
  }

  return (
    <div>
      <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
        Audit Log
      </h3>

      {/* Filters */}
      <form method="get" className="flex flex-wrap gap-3 mb-4 text-sm">
        <input
          name="action"
          placeholder="Filter by action..."
          defaultValue={filters.action ?? ""}
          className="rounded-md border-gray-300 p-1.5 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
        <input
          name="targetType"
          placeholder="Target type..."
          defaultValue={filters.targetType ?? ""}
          className="rounded-md border-gray-300 p-1.5 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
        <input
          name="from"
          type="date"
          defaultValue={filters.from ?? ""}
          className="rounded-md border-gray-300 p-1.5 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
        <input
          name="to"
          type="date"
          defaultValue={filters.to ?? ""}
          className="rounded-md border-gray-300 p-1.5 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Filter
        </button>
        <Link
          to="/admin/audit"
          className="rounded-md bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
        >
          Clear
        </Link>
      </form>

      {/* Events table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead>
            <tr className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Target</th>
              <th className="px-3 py-2">Actor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {events.map((e) => (
              <tr key={e.id}>
                <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {new Date(e.createdAt).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                    {e.action}
                  </span>
                </td>
                <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">
                  {e.targetType}:{e.targetId.substring(0, 8)}
                </td>
                <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                  {e.actorUserId.substring(0, 8)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {events.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-4">No audit events found.</p>
      )}

      {/* Pagination */}
      {nextCursor && (
        <div className="mt-4">
          <Link
            to={buildUrl({ cursor: nextCursor })}
            className="rounded-md bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          >
            Load more
          </Link>
        </div>
      )}
    </div>
  );
}
