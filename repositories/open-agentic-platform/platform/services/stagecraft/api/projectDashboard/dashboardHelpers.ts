// Spec 175 — pure helpers for the dashboard endpoint, isolated from
// Encore / Drizzle so unit tests can exercise them without standing up
// the runtime. `dashboard.ts` re-exports the same names so existing
// callers stay unchanged.

import type { AuditAuthSource } from "./types";

const DEFAULT_STALE_EXTRACTION_MS = 600_000;

/**
 * Reads `STATECRAFT_EXTRACT_STALE_AFTER_SEC` (seconds) and converts to
 * milliseconds. Falls back to 600s when unset / malformed / non-positive
 * to match the spec 115 sweeper's default.
 */
export function staleExtractionCutoffMs(): number {
  const raw = process.env.statecraft_EXTRACT_STALE_AFTER_SEC;
  const seconds = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }
  return DEFAULT_STALE_EXTRACTION_MS;
}

/**
 * Project a `factory_runs.stage_progress` jsonb array to "the most
 * recently entered stage id", or null when the row has no stage events
 * yet. Tolerates malformed entries so a single bad row never breaks the
 * panel build.
 */
export function lastStageId(progress: unknown): string | null {
  if (!Array.isArray(progress) || progress.length === 0) return null;
  const last = progress[progress.length - 1];
  if (last && typeof last === "object" && "stage_id" in last) {
    const id = (last as Record<string, unknown>).stage_id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

/**
 * Project `audit_log.metadata.authSource` onto the typed dashboard
 * audit row. Unrecognised / missing values surface as `unknown`.
 */
export function pickAuthSource(metadata: unknown): AuditAuthSource {
  if (!metadata || typeof metadata !== "object") return "unknown";
  const v = (metadata as Record<string, unknown>).authSource;
  if (v === "session" || v === "api_key" || v === "m2m") return v;
  return "unknown";
}

/** Short error message for `{ available: false, reason }` panel rejection. */
export function shortError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > 160 ? msg.slice(0, 157) + "..." : msg;
}
