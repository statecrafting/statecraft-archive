/**
 * Factory Overview (spec 108 Phase 3 + spec 109 §5 async sync).
 *
 * Sync is now async. The action enqueues a run on FactorySyncRequestTopic
 * and returns a sync_run_id; the page polls GET /api/factory/upstreams/sync/:id
 * until the run terminates. Recent runs are surfaced in a table fed by
 * GET /api/factory/upstreams/sync.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useRevalidator,
} from "react-router";
import { requireUser } from "../lib/auth.server";
import {
  getFactoryUpstreams,
  listFactorySyncRuns,
  syncFactoryUpstreams,
  type FactorySyncRun,
  type FactorySyncTriggerResponse,
  type FactoryUpstream,
  type FactoryUpstreamCounts,
} from "../lib/factory-api.server";

type LoaderData = {
  upstream: FactoryUpstream | null;
  counts: FactoryUpstreamCounts;
  canConfigure: boolean;
  runs: FactorySyncRun[];
};

export async function loader({
  request,
}: {
  request: Request;
}): Promise<LoaderData> {
  const user = await requireUser(request);
  const [{ upstream, counts }, { runs }] = await Promise.all([
    getFactoryUpstreams(request),
    listFactorySyncRuns(request).catch(() => ({ runs: [] as FactorySyncRun[] })),
  ]);
  const canConfigure =
    user.platformRole === "owner" || user.platformRole === "admin";
  return { upstream, counts, canConfigure, runs };
}

type ActionData = {
  error?: string;
  triggered?: FactorySyncTriggerResponse;
};

export async function action({
  request,
}: {
  request: Request;
}): Promise<ActionData> {
  const user = await requireUser(request);
  if (user.platformRole !== "owner" && user.platformRole !== "admin") {
    return { error: "Only org admins can run factory sync." };
  }

  try {
    const triggered = await syncFactoryUpstreams(request);
    return { triggered };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Sync failed.",
    };
  }
}

export default function FactoryOverview() {
  const { upstream, counts, canConfigure, runs } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const activeRun = useMemo(() => {
    if (actionData?.triggered) {
      return runs.find((r) => r.id === actionData.triggered!.syncRunId);
    }
    return runs.find((r) => r.status === "pending" || r.status === "running");
  }, [runs, actionData]);

  useSyncRunPolling(activeRun);

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wider">
              Upstream sources
            </h2>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              Factory adapters, contracts, and processes are generated from two
              GitHub sources. Replaces the legacy
              <code className="mx-1 px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 font-mono text-xs">
                factory/upstream-map.yaml
              </code>
              manifest.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <SyncButton
              disabled={!canConfigure || !upstream}
              isSubmitting={isSubmitting}
              activeRun={activeRun}
            />
            <Link
              to="/app/factory/upstreams"
              className="inline-flex items-center rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              {upstream ? "Edit" : canConfigure ? "Configure" : "View"}
            </Link>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <UpstreamCard
            title="Factory source"
            hint="Canonical process definitions and adapter scaffolds."
            repo={upstream?.factorySource ?? null}
            ref={upstream?.factoryRef ?? null}
            sha={upstream?.lastSyncSha?.factory ?? null}
            placeholder="statecrafting/factory"
          />
          <UpstreamCard
            title="Template source"
            hint="Per-project templates consumed by the factory."
            repo={upstream?.templateSource ?? null}
            ref={upstream?.templateRef ?? null}
            sha={upstream?.lastSyncSha?.template ?? null}
            placeholder="statecrafting/template"
          />
        </div>

        <SyncStatus
          upstream={upstream}
          actionError={actionData?.error ?? null}
          activeRun={activeRun}
        />
      </section>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Tile
          title="Adapters"
          description="Pluggable tech stacks — manifest-declared adapters (acme-vue-encore today)."
          count={counts.adapters}
        />
        <Tile
          title="Contracts"
          description="Build Spec, Adapter Manifest, Pipeline State, Verification schemas."
          count={counts.contracts}
        />
        <Tile
          title="Processes"
          description="7-stage pipeline definitions executed by OPC agents."
          count={counts.processes}
        />
      </div>

      <RecentRuns runs={runs} />
    </div>
  );
}

function useSyncRunPolling(activeRun: FactorySyncRun | undefined) {
  const revalidator = useRevalidator();
  useEffect(() => {
    if (!activeRun) return;
    if (activeRun.status !== "pending" && activeRun.status !== "running") return;
    const handle = setInterval(() => {
      revalidator.revalidate();
    }, 2000);
    return () => clearInterval(handle);
  }, [activeRun, revalidator]);
}

function SyncButton({
  disabled,
  isSubmitting,
  activeRun,
}: {
  disabled: boolean;
  isSubmitting: boolean;
  activeRun: FactorySyncRun | undefined;
}) {
  const inFlight =
    isSubmitting ||
    activeRun?.status === "pending" ||
    activeRun?.status === "running";
  return (
    <Form method="post">
      <button
        type="submit"
        disabled={disabled || inFlight}
        className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {inFlight ? "Syncing…" : "Sync now"}
      </button>
    </Form>
  );
}

function UpstreamCard({
  title,
  hint,
  repo,
  ref,
  sha,
  placeholder,
}: {
  title: string;
  hint: string;
  repo: string | null;
  ref: string | null;
  sha: string | null;
  placeholder: string;
}) {
  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-700 p-3">
      <div className="text-xs font-medium text-gray-700 dark:text-gray-300">
        {title}
      </div>
      <div className="mt-1 font-mono text-sm text-gray-900 dark:text-gray-100">
        {repo ?? (
          <span className="text-gray-400 dark:text-gray-500">
            {placeholder}
          </span>
        )}
      </div>
      <div className="mt-1 flex gap-3 text-xs text-gray-500 dark:text-gray-400">
        <span>
          ref: <code className="font-mono">{ref ?? "—"}</code>
        </span>
        <span>
          sha: <code className="font-mono">{sha ? sha.slice(0, 7) : "—"}</code>
        </span>
      </div>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{hint}</p>
    </div>
  );
}

function SyncStatus({
  upstream,
  actionError,
  activeRun,
}: {
  upstream: FactoryUpstream | null;
  actionError: string | null;
  activeRun: FactorySyncRun | undefined;
}) {
  if (!upstream) {
    return (
      <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
        No upstream configured yet. Configure sources before triggering sync.
      </div>
    );
  }

  const effectiveStatus =
    activeRun?.status ??
    (actionError ? "failed" : upstream.lastSyncStatus ?? "idle");

  // A configured-but-never-run upstream is idle, not pending: only show the
  // amber pending/running treatment when a sync actually exists.
  const neverSynced = !upstream.lastSyncedAt && effectiveStatus === "idle";

  const color =
    effectiveStatus === "ok"
      ? "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800"
      : effectiveStatus === "failed"
        ? "text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
        : effectiveStatus === "idle"
          ? "text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700"
          : "text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800";

  const errorMessage = actionError ?? activeRun?.error ?? upstream.lastSyncError;

  return (
    <div
      className={`mt-4 flex items-start gap-3 text-xs rounded border px-3 py-2 ${color}`}
    >
      <div className="flex-1">
        <div className="font-medium">
          {neverSynced ? (
            "Not synced yet. Press Sync now to pull the upstreams."
          ) : (
            <>
              Last sync:{" "}
              {upstream.lastSyncedAt
                ? new Date(upstream.lastSyncedAt).toLocaleString()
                : "never"}{" "}
              <span className="opacity-70">({effectiveStatus})</span>
            </>
          )}
        </div>
        {errorMessage ? (
          <div className="mt-1 font-mono text-[11px] break-all">
            {errorMessage}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RecentRuns({ runs }: { runs: FactorySyncRun[] }) {
  if (runs.length === 0) return null;
  return (
    <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wider">
        Recent syncs
      </h2>
      <table className="mt-4 w-full text-xs">
        <thead>
          <tr className="text-left text-gray-500 dark:text-gray-400">
            <th className="pb-2 font-medium">Status</th>
            <th className="pb-2 font-medium">Queued</th>
            <th className="pb-2 font-medium">Duration</th>
            <th className="pb-2 font-medium">Factory</th>
            <th className="pb-2 font-medium">Template</th>
            <th className="pb-2 font-medium">Counts</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <RunRow key={run.id} run={run} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function RunRow({ run }: { run: FactorySyncRun }) {
  const duration =
    run.startedAt && run.completedAt
      ? `${Math.round(
          (new Date(run.completedAt).getTime() -
            new Date(run.startedAt).getTime()) /
            1000
        )}s`
      : run.status === "running"
        ? "…"
        : "—";

  return (
    <tr className="border-t border-gray-100 dark:border-gray-800">
      <td className="py-2">
        <StatusPill status={run.status} />
      </td>
      <td className="py-2 text-gray-600 dark:text-gray-400">
        {new Date(run.queuedAt).toLocaleString()}
      </td>
      <td className="py-2 text-gray-600 dark:text-gray-400">{duration}</td>
      <td className="py-2 font-mono text-gray-600 dark:text-gray-400">
        {run.factorySha ? run.factorySha.slice(0, 7) : "—"}
      </td>
      <td className="py-2 font-mono text-gray-600 dark:text-gray-400">
        {run.templateSha ? run.templateSha.slice(0, 7) : "—"}
      </td>
      <td className="py-2 font-mono text-gray-600 dark:text-gray-400">
        {run.counts
          ? `A ${run.counts.adapters} / C ${run.counts.contracts} / P ${run.counts.processes}`
          : "—"}
      </td>
    </tr>
  );
}

function StatusPill({ status }: { status: FactorySyncRun["status"] }) {
  const cls =
    status === "ok"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
      : status === "failed"
        ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
        : status === "running"
          ? "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300"
          : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}
    >
      {status}
    </span>
  );
}

function Tile({
  title,
  description,
  count,
}: {
  title: string;
  description: string;
  count: number;
}) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {title}
        </h3>
        <span className="text-xs font-mono text-gray-400 dark:text-gray-500">
          {count}
        </span>
      </div>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {description}
      </p>
    </div>
  );
}
