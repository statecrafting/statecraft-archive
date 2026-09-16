/**
 * Spec 124 §7 — Run detail. Header + per-stage progress + token spend +
 * error block. While the run is in flight (`status IN 'queued','running'`)
 * the loader is revalidated on a 3-second interval to surface duplex events
 * the platform handler has already persisted.
 *
 * Polling vs. WebSocket: the duplex bus is at /api/sync/duplex but the SSR
 * loader can't subscribe directly. A client-only WebSocket is feasible but
 * adds auth-handshake complexity for every detail-page mount. Polling at
 * 3s while in-flight is the documented Phase 7 fallback (spec 124 plan
 * §Phase 7 / handoff). Stops as soon as `status` lands in a terminal
 * state. No polling for `ok` / `failed` / `cancelled` runs.
 */

import { useEffect } from "react";
import { Form, Link, useLoaderData, useNavigation, useRevalidator } from "react-router";
import { requireUser } from "../lib/auth.server";
import {
  approveFactoryRunGate,
  getFactoryRun,
  getFactoryRunApprovalContext,
  listFactoryAdapters,
  listFactoryProcesses,
  type FactoryRunDetail,
  type FactoryRunStageProgressEntry,
  type RunApprovalContextWire,
} from "../lib/factory-api.server";
import { runGateControlState } from "../lib/approval-basis-helpers";
import {
  STAGE_STATUS_CLASSES,
  STATUS_PILL_CLASSES,
  formatAgentRefTriple,
  formatDuration,
  shortContentHash,
  shouldPollRun,
} from "../lib/factory-run-helpers";

const POLL_INTERVAL_MS = 3000;

type LoaderData = {
  run: FactoryRunDetail;
  adapterName: string | null;
  processName: string | null;
  /** Spec 201 phase 3 — the HITL gate basis + recorded approvals. null on
   * fetch failure (renderer fails closed, FR-002). Read-only (FR-003). */
  approvalContext: RunApprovalContextWire | null;
};

export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { runId: string };
}): Promise<LoaderData> {
  await requireUser(request);
  if (!params.runId) {
    throw new Response("missing run id", { status: 400 });
  }
  // Resolve adapter / process names from their UUIDs. Failures are non-fatal:
  // the page falls back to short-UUID display so a partial outage of the
  // browse endpoints doesn't block the run-detail view.
  const [run, adaptersList, processesList, approvalContext] =
    await Promise.all([
      getFactoryRun(request, params.runId),
      listFactoryAdapters(request).catch(() => ({ adapters: [] })),
      listFactoryProcesses(request).catch(() => ({ processes: [] })),
      // Fail closed on fetch error: a null context renders an attributable
      // error with no approve control (spec 201 FR-002).
      getFactoryRunApprovalContext(request, params.runId).catch(() => null),
    ]);

  const adapterName =
    adaptersList.adapters.find((a) => a.id === run.adapterId)?.name ?? null;
  const processName =
    processesList.processes.find((p) => p.id === run.processId)?.name ?? null;

  return { run, adapterName, processName, approvalContext };
}

type ActionResult = { ok: boolean; error?: string };

/** Spec 201 FR-003 — approve is a distinct POST, never a loader side
 * effect. The summaryHash from the rendered basis rides along for the
 * replay guard; the server re-assembles and refuses on mismatch. */
export async function action({
  request,
  params,
}: {
  request: Request;
  params: { runId: string };
}): Promise<ActionResult> {
  await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent !== "approve_gate") {
    return { ok: false, error: `unknown intent: ${intent}` };
  }
  const stageId = String(form.get("stageId") ?? "");
  const summaryHash = String(form.get("summaryHash") ?? "");
  if (!stageId || !summaryHash) {
    return { ok: false, error: "missing stageId or summaryHash" };
  }
  try {
    await approveFactoryRunGate(request, params.runId, stageId, summaryHash);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export default function FactoryRunDetailRoute() {
  const { run, adapterName, processName, approvalContext } =
    useLoaderData<typeof loader>();
  useLiveRevalidation(run);

  return (
    <div className="space-y-6">
      <BreadcrumbAndStatus run={run} />
      <RunHeader
        run={run}
        adapterName={adapterName}
        processName={processName}
      />
      {run.status === "failed" && run.error && <ErrorBlock error={run.error} />}
      <StageProgressList stages={run.stageProgress} />
      <RunGateApprovalsPanel context={approvalContext} />
      <TokenSpendCard run={run} />
      <SourceShasFooter run={run} />
    </div>
  );
}

/**
 * Spec 201 phase 3 — the run-level HITL gate surface (FR-002). One row per
 * stage in the require_stage_approval policy; the approve control renders
 * only behind an assembled, clean basis. FR-005 is vacuously satisfied on
 * this page today: it renders statuses, durations, and content hashes —
 * no model-produced text. If stage OUTPUT bodies are ever rendered here,
 * they must go into a labelled untrusted region per FR-005.
 */
function RunGateApprovalsPanel({
  context,
}: {
  context: RunApprovalContextWire | null;
}) {
  const nav = useNavigation();
  const submitting = nav.state === "submitting";
  const requiredStageIds = context?.requiredStageIds ?? ["s1", "s2", "s3"];

  return (
    <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      <h3 className="border-b border-gray-200 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
        Stage approvals — human sign-off
      </h3>
      <ol className="divide-y divide-gray-100 dark:divide-gray-800">
        {requiredStageIds.map((stageId) => (
          <RunGateRow
            key={stageId}
            stageId={stageId}
            context={context}
            submitting={submitting}
          />
        ))}
      </ol>
    </div>
  );
}

function RunGateRow({
  stageId,
  context,
  submitting,
}: {
  stageId: string;
  context: RunApprovalContextWire | null;
  submitting: boolean;
}) {
  const state = runGateControlState(context, stageId);

  return (
    <li className="px-4 py-3 text-sm">
      <div className="flex items-start justify-between gap-4">
        <code className="text-xs font-medium text-gray-700 dark:text-gray-300">
          {stageId}
        </code>
        {state.kind === "approved" ? (
          <div className="text-right text-xs">
            <span className="font-semibold text-green-700 dark:text-green-400">
              approved
            </span>
            <div className="mt-0.5 font-mono text-[10px] text-gray-500">
              basis {state.approval.summaryHash.slice(0, 12)}… · @
              {state.approval.approvedBy.slice(0, 8)} ·{" "}
              {new Date(state.approval.approvedAt).toLocaleString()}
            </div>
          </div>
        ) : state.kind === "blocked" ? (
          <div className="max-w-md text-right text-xs text-red-700 dark:text-red-400">
            approval unavailable: {state.reason}
          </div>
        ) : state.kind === "withheld" ? (
          <div className="max-w-md text-right text-xs text-orange-700 dark:text-orange-400">
            approval withheld — unverified override(s) under the envelope's
            require_verified policy:
            <ul className="mt-1 font-mono text-[10px]">
              {state.blockingPaths.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="max-w-lg text-right">
            <dl className="space-y-1 text-left text-xs">
              <div>
                <dt className="inline font-semibold text-gray-500">
                  Gate predicate:{" "}
                </dt>
                <dd className="inline font-mono">{state.gatePredicate}</dd>
              </div>
              <div>
                <dt className="inline font-semibold text-gray-500">
                  Blast radius:{" "}
                </dt>
                <dd className="inline">{state.summary.blastRadiusStatement}</dd>
              </div>
              <div>
                <dt className="inline font-semibold text-gray-500">
                  Provenance:{" "}
                </dt>
                <dd className="inline font-mono text-[10px]">
                  {state.summary.provenanceLinks
                    .map((l) => `${l.kind}@${l.contentHash.slice(0, 12)}…`)
                    .join(", ")}
                </dd>
              </div>
            </dl>
            <Form method="post" className="mt-2">
              <input type="hidden" name="intent" value="approve_gate" />
              <input type="hidden" name="stageId" value={stageId} />
              <input
                type="hidden"
                name="summaryHash"
                value={state.summary.summaryHash}
              />
              <button
                type="submit"
                disabled={submitting}
                className="rounded border border-green-600 px-3 py-1 text-xs text-green-700 disabled:opacity-50 dark:text-green-400"
              >
                Approve {stageId} gate
              </button>
            </Form>
          </div>
        )}
      </div>
    </li>
  );
}

function useLiveRevalidation(run: FactoryRunDetail) {
  const revalidator = useRevalidator();
  useEffect(() => {
    if (!shouldPollRun(run.status)) return;
    const handle = setInterval(() => {
      revalidator.revalidate();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [run.status, revalidator]);
}

function BreadcrumbAndStatus({ run }: { run: FactoryRunDetail }) {
  const isLive = shouldPollRun(run.status);
  return (
    <div className="flex items-center justify-between">
      <nav className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <Link
          to="/app/factory/runs"
          className="hover:text-indigo-600 dark:hover:text-indigo-400"
        >
          Runs
        </Link>
        <span aria-hidden>›</span>
        <span className="font-mono text-xs text-gray-900 dark:text-gray-100">
          {run.id.slice(0, 8)}…
        </span>
      </nav>
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_PILL_CLASSES[run.status]}`}
        title={isLive ? "Live — auto-refreshing" : "Final status"}
      >
        {isLive && (
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
          </span>
        )}
        {run.status}
      </span>
    </div>
  );
}

function RunHeader({
  run,
  adapterName,
  processName,
}: {
  run: FactoryRunDetail;
  adapterName: string | null;
  processName: string | null;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-5 py-4 dark:border-gray-700 dark:bg-gray-900">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Adapter">
          <code className="text-gray-900 dark:text-gray-100">
            {adapterName ?? `${run.adapterId.slice(0, 8)}…`}
          </code>
        </Field>
        <Field label="Process">
          <code className="text-gray-900 dark:text-gray-100">
            {processName ?? `${run.processId.slice(0, 8)}…`}
          </code>
        </Field>
        <Field label="Project">
          {run.projectId ? (
            <Link
              to={`/app/project/${run.projectId}`}
              className="text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
            >
              {run.projectId.slice(0, 8)}…
            </Link>
          ) : (
            <span className="text-gray-400 dark:text-gray-600">ad-hoc</span>
          )}
        </Field>
        <Field label="Triggered by">
          <span
            className="font-mono text-xs text-gray-700 dark:text-gray-300"
            title={run.triggeredBy}
          >
            @{run.triggeredBy.slice(0, 8)}
          </span>
        </Field>
        <Field label="Started">
          <span className="text-gray-700 dark:text-gray-300">
            {new Date(run.startedAt).toLocaleString()}
          </span>
        </Field>
        <Field label="Duration">
          <span className="font-mono text-xs text-gray-700 dark:text-gray-300">
            {formatDuration(run.startedAt, run.completedAt)}
          </span>
        </Field>
      </dl>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {label}
      </dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function ErrorBlock({ error }: { error: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-900/20">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-red-700 dark:text-red-400">
        Error
      </h3>
      <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs text-red-800 dark:text-red-300">
        {error}
      </pre>
    </div>
  );
}

function StageProgressList({
  stages,
}: {
  stages: FactoryRunStageProgressEntry[];
}) {
  if (stages.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
        Awaiting first stage…
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      <h3 className="border-b border-gray-200 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
        Stage progress
      </h3>
      <ol className="divide-y divide-gray-100 dark:divide-gray-800">
        {stages.map((s, idx) => (
          <StageRow key={`${s.stage_id}-${idx}`} stage={s} />
        ))}
      </ol>
    </div>
  );
}

function StageRow({ stage }: { stage: FactoryRunStageProgressEntry }) {
  const duration = formatDuration(stage.started_at, stage.completed_at);
  const ref = stage.agent_ref;
  return (
    <li className="grid grid-cols-[8rem_1fr_auto_auto] items-center gap-4 px-4 py-2.5">
      <code className="text-xs font-medium text-gray-700 dark:text-gray-300">
        {stage.stage_id}
      </code>
      <span
        className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_STATUS_CLASSES[stage.status]}`}
      >
        {stage.status}
      </span>
      <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
        {duration}
      </span>
      {ref ? (
        <span
          className="cursor-help font-mono text-[10px] uppercase text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-200"
          title={formatAgentRefTriple(ref)}
        >
          {shortContentHash(ref.contentHash)}
        </span>
      ) : (
        <span className="text-[10px] text-gray-300 dark:text-gray-700">—</span>
      )}
    </li>
  );
}

function TokenSpendCard({ run }: { run: FactoryRunDetail }) {
  if (!run.tokenSpend) {
    return null;
  }
  const { input, output, total } = run.tokenSpend;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-5 py-4 dark:border-gray-700 dark:bg-gray-900">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        Token spend
      </h3>
      <dl className="mt-3 grid grid-cols-3 gap-6">
        <Stat label="Input" value={input.toLocaleString()} />
        <Stat label="Output" value={output.toLocaleString()} />
        <Stat label="Total" value={total.toLocaleString()} accent />
      </dl>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {label}
      </dt>
      <dd
        className={`mt-1 font-mono text-lg ${
          accent
            ? "text-indigo-600 dark:text-indigo-400"
            : "text-gray-900 dark:text-gray-100"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function SourceShasFooter({ run }: { run: FactoryRunDetail }) {
  const { adapter, process, contracts, agents } = run.sourceShas;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-5 py-4 dark:border-gray-700 dark:bg-gray-900">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        Source SHAs
      </h3>
      <dl className="mt-3 space-y-1 text-xs">
        <ShaRow label="Adapter" sha={adapter} />
        <ShaRow label="Process" sha={process} />
        {Object.entries(contracts).map(([name, sha]) => (
          <ShaRow key={name} label={`Contract · ${name}`} sha={sha} />
        ))}
        {agents.length > 0 && (
          <div className="pt-2">
            <span className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Agents ({agents.length})
            </span>
            <ul className="mt-1 space-y-0.5 pl-2">
              {agents.map((a, idx) => (
                <li
                  key={`${a.orgAgentId}-${idx}`}
                  className="font-mono text-[11px] text-gray-600 dark:text-gray-400"
                >
                  v{a.version} · {shortContentHash(a.contentHash)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </dl>
    </div>
  );
}

function ShaRow({ label, sha }: { label: string; sha: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-32 shrink-0 text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {label}
      </span>
      <code className="font-mono text-[11px] text-gray-700 dark:text-gray-300">
        {sha ? shortContentHash(sha) : "—"}
      </code>
    </div>
  );
}
