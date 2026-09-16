// Spec 113 §FR-008..FR-016 — Clone Project dialog.
// Spec 114 §5.4 — submit returns a job id; the dialog then polls the
// run-status SSR proxy until terminal state.
//
// Pre-fills `name = "<source.name> (clone)"`, `slug = "<source.slug>-clone"`,
// `repoName = "<sourceRepoName>-clone"`. Each editable field runs a
// debounced (300ms) availability check via the SSR proxy
// (/app/projects/clone-availability) and renders one of five indicator
// states. Submit is disabled while either field is in `checking`,
// `unavailable`, or `invalid`. Submit POSTs to /app/projects/{id}/clone,
// receives `{ cloneJobId }`, then polls
// /app/projects/clone-runs/{cloneJobId} every ~1.5s until status is
// `ok` (navigate) or `failed` (surface typed error inline).
//
// Pre-fill values that match the server's defaults are silently suffix-
// uniquified server-side; user-typed values that conflict surface as
// `name_taken` / `slug_taken` with no rewrite (spec §FR-029, FR-030).

import { useEffect, useRef, useState } from "react";
import type {
  CloneAvailabilityResponse,
  CloneAvailabilityVerdict,
  CloneJobAccepted,
  CloneRunStatus,
} from "../lib/projects-api.server";

/**
 * Spec 114 §5.4 — shape passed to `onSubmitted` once a clone reaches
 * terminal `ok`. Mirrors the worker-recorded final values so the caller
 * can navigate with truth, not the user-typed request.
 */
export interface CloneSubmitOutcome {
  projectId: string;
  finalName: string;
  finalSlug: string;
  repoFullName: string | null;
  opcDeepLink: string | null;
}

const POLL_INTERVAL_MS = 1500;
const POLL_JITTER_MS = 250;
const POLL_MAX_5XX = 4;
const POLL_BACKOFF_MS = [1500, 3000, 6000, 12000];

export type CloneSourceProject = {
  id: string;
  name: string;
  slug: string;
  /**
   * The destination GitHub org login (e.g. `statecrafting`). Read-only
   * in the dialog. Surfaced via the loader so the user knows where the
   * new repo will land.
   */
  destinationGithubOrgLogin: string;
  /** Source primary repo name — `defaultRepoName` builds `<repoName>-clone`. */
  sourceRepoName: string;
};

type FieldState = CloneAvailabilityVerdict["state"] | "idle";

interface FieldStatus {
  state: FieldState;
  reason?: CloneAvailabilityVerdict["reason"];
  retryAfterSec?: number;
}

const DEBOUNCE_MS = 300;
const PROJECT_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const GITHUB_REPO_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

function clientValidateRepoName(s: string): boolean {
  if (!s || s === "." || s === "..") return false;
  return GITHUB_REPO_NAME_RE.test(s);
}

function clientValidateSlug(s: string): boolean {
  return PROJECT_SLUG_RE.test(s);
}

export function CloneProjectDialog({
  source,
  onClose,
  onSubmitted,
}: {
  source: CloneSourceProject;
  onClose: () => void;
  onSubmitted: (outcome: CloneSubmitOutcome) => void;
}) {
  const defaultName = `${source.name} (clone)`;
  const defaultSlug = `${source.slug}-clone`;
  const defaultRepoName = `${source.sourceRepoName}-clone`;

  const [name, setName] = useState(defaultName);
  const [slug, setSlug] = useState(defaultSlug);
  const [repoName, setRepoName] = useState(defaultRepoName);
  const [slugStatus, setSlugStatus] = useState<FieldStatus>({ state: "idle" });
  const [repoNameStatus, setRepoNameStatus] = useState<FieldStatus>({
    state: "idle",
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitErrorDetail, setSubmitErrorDetail] = useState<string | null>(
    null,
  );
  const [pollElapsedSec, setPollElapsedSec] = useState(0);
  const pollAbort = useRef<AbortController | null>(null);

  const slugDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repoNameDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slugAbort = useRef<AbortController | null>(null);
  const repoNameAbort = useRef<AbortController | null>(null);

  // ── Availability calls ───────────────────────────────────────────────
  async function runAvailability(
    field: "slug" | "repoName",
    value: string,
    signal: AbortSignal
  ): Promise<CloneAvailabilityResponse | null> {
    const qs = new URLSearchParams({ [field]: value });
    try {
      const resp = await fetch(
        `/app/projects/clone-availability?${qs.toString()}`,
        { signal, headers: { Accept: "application/json" } }
      );
      if (!resp.ok) return null;
      return (await resp.json()) as CloneAvailabilityResponse;
    } catch {
      return null;
    }
  }

  function scheduleSlugCheck(value: string) {
    if (slugDebounce.current) clearTimeout(slugDebounce.current);
    if (slugAbort.current) slugAbort.current.abort();
    if (!clientValidateSlug(value)) {
      setSlugStatus({ state: "invalid", reason: "format" });
      return;
    }
    setSlugStatus({ state: "checking" as FieldState });
    slugDebounce.current = setTimeout(async () => {
      const ctrl = new AbortController();
      slugAbort.current = ctrl;
      const out = await runAvailability("slug", value, ctrl.signal);
      if (ctrl.signal.aborted) return;
      const verdict = out?.slug;
      if (!verdict) {
        setSlugStatus({ state: "unverifiable", reason: "transient_error" });
        return;
      }
      setSlugStatus({
        state: verdict.state,
        reason: verdict.reason,
        retryAfterSec: verdict.retryAfterSec,
      });
    }, DEBOUNCE_MS);
  }

  function scheduleRepoNameCheck(value: string) {
    if (repoNameDebounce.current) clearTimeout(repoNameDebounce.current);
    if (repoNameAbort.current) repoNameAbort.current.abort();
    if (!clientValidateRepoName(value)) {
      setRepoNameStatus({ state: "invalid", reason: "format" });
      return;
    }
    setRepoNameStatus({ state: "checking" as FieldState });
    repoNameDebounce.current = setTimeout(async () => {
      const ctrl = new AbortController();
      repoNameAbort.current = ctrl;
      const out = await runAvailability("repoName", value, ctrl.signal);
      if (ctrl.signal.aborted) return;
      const verdict = out?.repoName;
      if (!verdict) {
        setRepoNameStatus({
          state: "unverifiable",
          reason: "transient_error",
        });
        return;
      }
      setRepoNameStatus({
        state: verdict.state,
        reason: verdict.reason,
        retryAfterSec: verdict.retryAfterSec,
      });
    }, DEBOUNCE_MS);
  }

  // FR-009 — initial availability call on mount so neither field starts in idle.
  useEffect(() => {
    scheduleSlugCheck(slug);
    scheduleRepoNameCheck(repoName);
    return () => {
      if (slugDebounce.current) clearTimeout(slugDebounce.current);
      if (repoNameDebounce.current) clearTimeout(repoNameDebounce.current);
      if (slugAbort.current) slugAbort.current.abort();
      if (repoNameAbort.current) repoNameAbort.current.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Submit + poll ───────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitErrorDetail(null);
    setSubmitting(true);
    setPollElapsedSec(0);
    try {
      const resp = await fetch(`/app/projects/${source.id}/clone`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ name, slug, repoName }),
      });
      const body = await resp.json();
      if (!resp.ok) {
        setSubmitError(
          (body as { error?: string }).error ?? `HTTP ${resp.status}`,
        );
        setSubmitting(false);
        return;
      }
      const accepted = body as CloneJobAccepted;
      const ctrl = new AbortController();
      pollAbort.current = ctrl;
      const startedAt = Date.now();
      const timer = setInterval(() => {
        setPollElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
      }, 1000);
      try {
        const terminal = await pollUntilTerminal(
          accepted.cloneJobId,
          ctrl.signal,
        );
        clearInterval(timer);
        if (terminal.status === "ok" && terminal.projectId) {
          onSubmitted({
            projectId: terminal.projectId,
            finalName: terminal.finalName ?? name,
            finalSlug: terminal.finalSlug ?? slug,
            repoFullName: terminal.repoFullName,
            opcDeepLink: terminal.opcDeepLink,
          });
          return;
        }
        // failed
        setSubmitError(
          terminal.error ?? "Clone failed for an unknown reason.",
        );
        setSubmitErrorDetail(terminal.errorDetail);
        setSubmitting(false);
      } catch (err) {
        clearInterval(timer);
        setSubmitError(err instanceof Error ? err.message : String(err));
        setSubmitting(false);
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  // Cancel any in-flight polling on unmount so an aborted dialog doesn't
  // leak a fetch loop.
  useEffect(() => {
    return () => {
      if (pollAbort.current) pollAbort.current.abort();
    };
  }, []);

  const submittable =
    !submitting &&
    canSubmitField(slugStatus.state) &&
    canSubmitField(repoNameStatus.state);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        // FR-014 — clicking the backdrop only closes when not submitting.
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="clone-dialog-title"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-lg bg-white dark:bg-gray-900 shadow-xl border border-gray-200 dark:border-gray-800 p-6 space-y-4"
      >
        <div>
          <h2
            id="clone-dialog-title"
            className="text-lg font-semibold text-gray-900 dark:text-gray-100"
          >
            Clone project
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Duplicate <span className="font-medium">{source.name}</span> into a
            new project bound to a fresh GitHub repo under{" "}
            <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">
              {source.destinationGithubOrgLogin}
            </code>
            .
          </p>
        </div>

        <div className="space-y-3">
          <Field label="Project name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              disabled={submitting}
            />
          </Field>

          <Field
            label="Project slug"
            indicator={<Indicator status={slugStatus} />}
          >
            <input
              type="text"
              value={slug}
              onChange={(e) => {
                const next = e.target.value;
                setSlug(next);
                scheduleSlugCheck(next);
              }}
              className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              disabled={submitting}
              autoCapitalize="off"
              autoComplete="off"
            />
            <FieldHint status={slugStatus} kind="slug" />
          </Field>

          <Field
            label="GitHub repo name"
            indicator={<Indicator status={repoNameStatus} />}
          >
            <div className="flex items-center">
              <span className="px-3 py-2 text-sm rounded-l-md border border-r-0 border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                {source.destinationGithubOrgLogin}/
              </span>
              <input
                type="text"
                value={repoName}
                onChange={(e) => {
                  const next = e.target.value;
                  setRepoName(next);
                  scheduleRepoNameCheck(next);
                }}
                className="flex-1 px-3 py-2 text-sm rounded-r-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                disabled={submitting}
                autoCapitalize="off"
                autoComplete="off"
              />
            </div>
            <FieldHint status={repoNameStatus} kind="repoName" />
          </Field>
        </div>

        {submitError && (
          <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-300 space-y-2">
            <div>{submitError}</div>
            {submitErrorDetail && (
              <pre className="whitespace-pre-wrap break-words text-xs font-mono text-red-800 dark:text-red-200 bg-red-100/60 dark:bg-red-950/40 rounded px-2 py-1 max-h-40 overflow-auto">
                {submitErrorDetail}
              </pre>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!submittable}
            className="px-4 py-2 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting
              ? pollElapsedSec > 0
                ? `Cloning… (${pollElapsedSec}s)`
                : "Cloning…"
              : "Clone project"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FR-013 — Submit gating: disabled while idle, checking, unavailable,
//           invalid. Allowed when available or unverifiable.
// ---------------------------------------------------------------------------

function canSubmitField(state: FieldState): boolean {
  return state === "available" || state === "unverifiable";
}

// ---------------------------------------------------------------------------
// Indicator — FR-012's four primary states (plus `idle` and `invalid`).
// ---------------------------------------------------------------------------

function Indicator({ status }: { status: FieldStatus }) {
  switch (status.state) {
    case "checking":
      return (
        <span className="text-xs text-gray-500 dark:text-gray-400">
          Checking…
        </span>
      );
    case "available":
      return (
        <span className="text-xs text-green-600 dark:text-green-400">
          Available
        </span>
      );
    case "unavailable":
      return (
        <span className="text-xs text-red-600 dark:text-red-400">
          {status.reason === "exists" ? "Already exists" : "Unavailable"}
        </span>
      );
    case "invalid":
      return (
        <span className="text-xs text-red-600 dark:text-red-400">
          Invalid name
        </span>
      );
    case "unverifiable":
      return (
        <span className="text-xs text-amber-600 dark:text-amber-400">
          {status.reason === "rate_limited"
            ? `Rate-limited${
                status.retryAfterSec
                  ? ` (retry in ${status.retryAfterSec}s)`
                  : ""
              }`
            : status.reason === "no_installation"
              ? "No GitHub installation"
              : "Unable to verify"}
        </span>
      );
    case "idle":
    default:
      return null;
  }
}

function FieldHint({
  status,
  kind,
}: {
  status: FieldStatus;
  kind: "slug" | "repoName";
}) {
  if (status.state !== "invalid") return null;
  return (
    <p className="mt-1 text-xs text-red-500 dark:text-red-400">
      {kind === "slug"
        ? "Lowercase letters, digits, and hyphens; max 63 chars; must start with a letter or digit."
        : "Letters, digits, hyphens, underscores, and dots; max 100 chars."}
    </p>
  );
}

function Field({
  label,
  indicator,
  children,
}: {
  label: string;
  indicator?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
          {label}
        </span>
        <div>{indicator}</div>
      </div>
      {children}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Spec 114 §FR-015..FR-019 — terminal-state polling.
// ---------------------------------------------------------------------------

async function pollUntilTerminal(
  cloneJobId: string,
  signal: AbortSignal,
): Promise<CloneRunStatus> {
  let consecutive5xx = 0;
  while (true) {
    if (signal.aborted) throw new Error("polling aborted");
    let resp: Response;
    try {
      resp = await fetch(
        `/app/projects/clone-runs/${encodeURIComponent(cloneJobId)}`,
        { signal, headers: { Accept: "application/json" } },
      );
    } catch (err) {
      if (signal.aborted) throw err;
      // Network blip — treat as transient and retry with backoff.
      consecutive5xx++;
      if (consecutive5xx > POLL_MAX_5XX) {
        throw new Error("Lost contact with server while polling clone status.");
      }
      await sleep(POLL_BACKOFF_MS[consecutive5xx - 1] ?? 12000, signal);
      continue;
    }
    if (resp.status >= 500) {
      consecutive5xx++;
      if (consecutive5xx > POLL_MAX_5XX) {
        throw new Error("Server kept returning 5xx while polling clone status.");
      }
      await sleep(POLL_BACKOFF_MS[consecutive5xx - 1] ?? 12000, signal);
      continue;
    }
    if (!resp.ok) {
      const body = (await resp.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${resp.status}`);
    }
    consecutive5xx = 0;
    const status = (await resp.json()) as CloneRunStatus;
    if (status.status === "ok" || status.status === "failed") {
      return status;
    }
    const jitter = Math.floor((Math.random() - 0.5) * 2 * POLL_JITTER_MS);
    await sleep(POLL_INTERVAL_MS + jitter, signal);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      signal.removeEventListener("abort", onAbort);
      reject(new Error("aborted"));
    };
    signal.addEventListener("abort", onAbort);
  });
}
