/**
 * Spec 124 §7 — Runs tab: org-scoped list of factory runs with filters
 * (status multi-select, adapter single-select, date range) and cursor
 * pagination by `started_at`.
 *
 * Date range filter: `?after` is not supported by the listRuns endpoint
 * (spec 124 §4 only ships `?before` for cursor pagination). Per the
 * Phase 7 handoff we filter rows with `started_at < after` client-side
 * here, defaulting to "last 14 days". Trade-off: a paginated page can
 * arrive partially full when the server returned older rows that drop
 * out — acceptable for v1; revisit if operators ever need many-page
 * date-bounded scans.
 */

import { Link, useLoaderData, useSearchParams } from "react-router";
import { requireUser } from "../lib/auth.server";
import {
  listFactoryAdapters,
  listFactoryProcesses,
  listFactoryRuns,
  type FactoryResourceSummary,
  type FactoryRunStatus,
  type FactoryRunSummary,
} from "../lib/factory-api.server";
import {
  STATUS_PILL_CLASSES,
  formatDuration,
  shouldPollRun,
} from "../lib/factory-run-helpers";

const ALL_STATUSES: FactoryRunStatus[] = [
  "queued",
  "running",
  "ok",
  "failed",
  "cancelled",
];

const DEFAULT_DAYS = 14;
const PAGE_SIZE = 50;

type LoaderData = {
  runs: FactoryRunSummary[];
  /** name → uuid + display fields. Used to render adapter / process names
   *  from the UUIDs on `RunSummary`. Process names are resolved from a
   *  similar map; we re-use FactoryResourceSummary for both. */
  adapterIndex: Record<string, FactoryResourceSummary>;
  processIndex: Record<string, FactoryResourceSummary>;
  adapterOptions: FactoryResourceSummary[];
  filters: {
    statuses: FactoryRunStatus[];
    adapter: string | null;
    afterISO: string;
  };
  nextCursor: string | undefined;
  /** Number of rows the server returned that the client filter dropped.
   *  Surfaced as a hint so operators understand a partial page. */
  droppedByDateFilter: number;
};

function parseStatuses(raw: string[]): FactoryRunStatus[] {
  const allowed = new Set(ALL_STATUSES);
  return raw.filter((s): s is FactoryRunStatus =>
    allowed.has(s as FactoryRunStatus)
  );
}

function defaultAfterISO(now: Date = new Date(), days = DEFAULT_DAYS): string {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export async function loader({
  request,
}: {
  request: Request;
}): Promise<LoaderData> {
  await requireUser(request);
  const url = new URL(request.url);

  const statusParams = url.searchParams.getAll("status");
  const statuses = parseStatuses(statusParams);
  const adapter = url.searchParams.get("adapter") || null;
  const afterParam = url.searchParams.get("after");
  const afterISO = afterParam ?? defaultAfterISO();
  const before = url.searchParams.get("before") ?? undefined;

  // Multi-status: the server endpoint takes a single `status`. When the user
  // selects multiple statuses we fetch unfiltered and narrow client-side
  // (typical operator workload is small enough that one page covers it).
  const serverStatus = statuses.length === 1 ? statuses[0] : undefined;

  // Adapter / process lists power both the filter dropdown and the id-to-name
  // lookup used to render columns. Failures are non-fatal — the table falls
  // back to showing truncated UUIDs.
  const [{ runs }, adaptersList, processesList] = await Promise.all([
    listFactoryRuns(request, {
      status: serverStatus,
      adapter: adapter ?? undefined,
      limit: PAGE_SIZE,
      before,
    }),
    listFactoryAdapters(request).catch(() => ({
      adapters: [] as FactoryResourceSummary[],
    })),
    listFactoryProcesses(request).catch(() => ({
      processes: [] as FactoryResourceSummary[],
    })),
  ]);

  const adapterIndex: Record<string, FactoryResourceSummary> = {};
  for (const a of adaptersList.adapters) {
    if (a.id) adapterIndex[a.id] = a;
  }
  const processIndex: Record<string, FactoryResourceSummary> = {};
  for (const p of processesList.processes) {
    if (p.id) processIndex[p.id] = p;
  }

  // Apply client-side filters: multi-status (when >1 selected) and date.
  const afterMs = Date.parse(afterISO);
  const filtered: FactoryRunSummary[] = [];
  let dropped = 0;
  for (const run of runs) {
    if (statuses.length > 1 && !statuses.includes(run.status)) {
      dropped += 1;
      continue;
    }
    if (!Number.isNaN(afterMs)) {
      const startedMs = Date.parse(run.startedAt);
      if (!Number.isNaN(startedMs) && startedMs < afterMs) {
        dropped += 1;
        continue;
      }
    }
    filtered.push(run);
  }

  // Cursor: if the server gave us a full PAGE_SIZE page, surface its
  // last `started_at` as the next cursor — even when client-side filters
  // dropped some rows, the server pagination boundary is what matters.
  const nextCursor =
    runs.length === PAGE_SIZE ? runs[runs.length - 1].startedAt : undefined;

  return {
    runs: filtered,
    adapterIndex,
    processIndex,
    adapterOptions: adaptersList.adapters,
    filters: {
      statuses,
      adapter,
      afterISO,
    },
    nextCursor,
    droppedByDateFilter: dropped,
  };
}

export default function FactoryRunsList() {
  const data = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  const setStatuses = (next: FactoryRunStatus[]) => {
    setSearchParams(
      (prev) => {
        prev.delete("status");
        for (const s of next) prev.append("status", s);
        prev.delete("before");
        return prev;
      },
      { preventScrollReset: true }
    );
  };

  const setAdapter = (next: string) => {
    setSearchParams(
      (prev) => {
        if (next) prev.set("adapter", next);
        else prev.delete("adapter");
        prev.delete("before");
        return prev;
      },
      { preventScrollReset: true }
    );
  };

  const setAfter = (nextISO: string) => {
    setSearchParams(
      (prev) => {
        prev.set("after", nextISO);
        prev.delete("before");
        return prev;
      },
      { preventScrollReset: true }
    );
  };

  const goToCursor = (cursor: string | undefined) => {
    setSearchParams(
      (prev) => {
        if (cursor) prev.set("before", cursor);
        else prev.delete("before");
        return prev;
      },
      { preventScrollReset: true }
    );
  };

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-900 dark:text-gray-100">
            Recent runs
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Factory runs initiated from any OAP desktop in this org. Live-update
            on the detail view while a run is in flight.
          </p>
        </div>
      </header>

      <RunsFilterBar
        statuses={data.filters.statuses}
        adapter={data.filters.adapter}
        afterISO={data.filters.afterISO}
        adapterOptions={data.adapterOptions}
        onStatusesChange={setStatuses}
        onAdapterChange={setAdapter}
        onAfterChange={setAfter}
      />

      {data.runs.length === 0 ? (
        <EmptyState hasFilters={hasActiveFilters(data.filters)} />
      ) : (
        <RunsTable
          runs={data.runs}
          adapterIndex={data.adapterIndex}
          processIndex={data.processIndex}
        />
      )}

      <PaginationControls
        nextCursor={data.nextCursor}
        before={searchParams.get("before") ?? undefined}
        droppedByDateFilter={data.droppedByDateFilter}
        onGoToCursor={goToCursor}
      />
    </div>
  );
}

function hasActiveFilters(f: LoaderData["filters"]): boolean {
  if (f.statuses.length > 0) return true;
  if (f.adapter) return true;
  // Date filter is "active" only if it deviates from the default 14-day window.
  const defaultAfter = defaultAfterISO();
  return Math.abs(Date.parse(f.afterISO) - Date.parse(defaultAfter)) >
    24 * 60 * 60 * 1000;
}

function RunsFilterBar({
  statuses,
  adapter,
  afterISO,
  adapterOptions,
  onStatusesChange,
  onAdapterChange,
  onAfterChange,
}: {
  statuses: FactoryRunStatus[];
  adapter: string | null;
  afterISO: string;
  adapterOptions: FactoryResourceSummary[];
  onStatusesChange: (next: FactoryRunStatus[]) => void;
  onAdapterChange: (next: string) => void;
  onAfterChange: (next: string) => void;
}) {
  const toggle = (s: FactoryRunStatus) => {
    onStatusesChange(
      statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s]
    );
  };

  // <input type="date"> wants YYYY-MM-DD, not ISO; convert in both directions.
  const afterDate = afterISO.slice(0, 10);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-900">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Status
        </span>
        {ALL_STATUSES.map((s) => {
          const active = statuses.includes(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggle(s)}
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                active
                  ? STATUS_PILL_CLASSES[s]
                  : "bg-transparent text-gray-500 ring-1 ring-inset ring-gray-200 hover:ring-gray-300 dark:text-gray-400 dark:ring-gray-700 dark:hover:ring-gray-600"
              }`}
              aria-pressed={active}
            >
              {s}
            </button>
          );
        })}
      </div>

      <div className="h-6 w-px bg-gray-200 dark:bg-gray-700" aria-hidden />

      <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        Adapter
        <select
          value={adapter ?? ""}
          onChange={(e) => onAdapterChange(e.target.value)}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        >
          <option value="">All</option>
          {adapterOptions.map((a) => (
            <option key={a.name} value={a.name}>
              {a.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        Since
        <input
          type="date"
          value={afterDate}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            // Inclusive: midnight UTC at the start of the chosen day.
            onAfterChange(`${v}T00:00:00.000Z`);
          }}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
      </label>
    </div>
  );
}

function RunsTable({
  runs,
  adapterIndex,
  processIndex,
}: {
  runs: FactoryRunSummary[];
  adapterIndex: Record<string, FactoryResourceSummary>;
  processIndex: Record<string, FactoryResourceSummary>;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead className="bg-gray-50 dark:bg-gray-800/50">
          <tr>
            <Th>Status</Th>
            <Th>Started</Th>
            <Th>Duration</Th>
            <Th>Adapter</Th>
            <Th>Process</Th>
            <Th>Project</Th>
            <Th>Triggered by</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white dark:divide-gray-800 dark:bg-gray-900">
          {runs.map((run) => {
            const adapterName =
              adapterIndex[run.adapterId]?.name ??
              `${run.adapterId.slice(0, 8)}…`;
            const processName =
              processIndex[run.processId]?.name ??
              `${run.processId.slice(0, 8)}…`;
            const isLive = shouldPollRun(run.status);
            return (
              <tr
                key={run.id}
                className="cursor-pointer transition-colors hover:bg-indigo-50/40 dark:hover:bg-indigo-900/10"
              >
                <Td>
                  <Link
                    to={`/app/factory/runs/${run.id}`}
                    className="block focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 dark:focus:ring-offset-gray-900"
                  >
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_PILL_CLASSES[run.status]}`}
                    >
                      {isLive && (
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
                        </span>
                      )}
                      {run.status}
                    </span>
                  </Link>
                </Td>
                <Td>
                  <Link
                    to={`/app/factory/runs/${run.id}`}
                    className="block text-gray-900 hover:text-indigo-600 dark:text-gray-100 dark:hover:text-indigo-400"
                  >
                    {new Date(run.startedAt).toLocaleString()}
                  </Link>
                </Td>
                <Td>
                  <span className="font-mono text-xs text-gray-600 dark:text-gray-400">
                    {formatDuration(run.startedAt, run.completedAt)}
                  </span>
                </Td>
                <Td>
                  <code className="text-xs text-gray-700 dark:text-gray-300">
                    {adapterName}
                  </code>
                </Td>
                <Td>
                  <code className="text-xs text-gray-700 dark:text-gray-300">
                    {processName}
                  </code>
                </Td>
                <Td>
                  {run.projectId ? (
                    <Link
                      to={`/app/project/${run.projectId}`}
                      className="text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {run.projectId.slice(0, 8)}…
                    </Link>
                  ) : (
                    <span className="text-xs text-gray-400 dark:text-gray-600">
                      ad-hoc
                    </span>
                  )}
                </Td>
                <Td>
                  <span
                    className="font-mono text-xs text-gray-500 dark:text-gray-400"
                    title={run.triggeredBy}
                  >
                    @{run.triggeredBy.slice(0, 8)}
                  </span>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="whitespace-nowrap px-3 py-2 text-sm">{children}</td>;
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  if (hasFilters) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 px-6 py-12 text-center dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          No runs match those filters
        </h3>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          Widen the date range or clear status / adapter to see more runs.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-dashed border-gray-300 px-6 py-12 text-center dark:border-gray-700">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
        No factory runs yet
      </h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">
        Trigger a run from the OAP desktop app to see it here. Runs originate
        on the desktop and stream their progress back to this view in real
        time.
      </p>
    </div>
  );
}

function PaginationControls({
  nextCursor,
  before,
  droppedByDateFilter,
  onGoToCursor,
}: {
  nextCursor: string | undefined;
  before: string | undefined;
  droppedByDateFilter: number;
  onGoToCursor: (cursor: string | undefined) => void;
}) {
  if (!nextCursor && !before && droppedByDateFilter === 0) return null;
  return (
    <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
      <div>
        {droppedByDateFilter > 0 && (
          <span>
            {droppedByDateFilter} row{droppedByDateFilter === 1 ? "" : "s"}{" "}
            hidden by current filters.
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {before && (
          <button
            type="button"
            onClick={() => onGoToCursor(undefined)}
            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            ← Newest
          </button>
        )}
        {nextCursor && (
          <button
            type="button"
            onClick={() => onGoToCursor(nextCursor)}
            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            Older →
          </button>
        )}
      </div>
    </div>
  );
}
