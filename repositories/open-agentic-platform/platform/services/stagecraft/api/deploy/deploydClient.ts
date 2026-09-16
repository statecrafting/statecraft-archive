import log from "encore.dev/log";
import { getCachedDeploydAuthHeader } from "./oidcM2m";
import { readSecretFromDir } from "./secrets";

// Spec 215 FR-007: this module is the single deployd-api client. M2M secret
// resolution and the token cache (via oidcM2m.ts) live here once; `deploy.ts`
// (the raw proxy) and the new trigger path (deployments.ts) import
// `getDeploydAuthHeader` / `DEPLOYD_URL` rather than re-deriving credentials.
export const DEPLOYD_URL =
  process.env.DEPLOYD_URL ?? "http://deployd-api.deployd-system.svc.cluster.local";
const OIDC_ENDPOINT = process.env.OIDC_ENDPOINT ?? process.env.LOGTO_ENDPOINT ?? "";
const DEPLOYD_AUDIENCE = process.env.DEPLOYD_AUDIENCE ?? "";
const DEPLOYD_SCOPE = process.env.DEPLOYD_SCOPE ?? "";

/**
 * Render a transport-level fetch failure into an actionable diagnostic.
 *
 * Node's global fetch (undici) throws a `TypeError` whose `message` is the
 * uninformative `"fetch failed"`; the real cause (a DNS / connect / TLS /
 * timeout error, with a `code` like `ECONNREFUSED`, `ENOTFOUND`, or
 * `UND_ERR_HEADERS_TIMEOUT`) lives on `err.cause`. Surfacing the code and
 * cause message makes a REQUEST_FAILED row say what actually went wrong
 * (e.g. deployd unreachable vs the headers timeout that fires when deployd
 * holds the connection during a long synchronous `helm --wait`).
 */
export function describeTransportError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  if (cause && typeof cause === "object") {
    const c = cause as { code?: unknown; message?: unknown };
    const code = typeof c.code === "string" ? c.code : undefined;
    const causeMsg = typeof c.message === "string" ? c.message : undefined;
    const detail = [code, causeMsg].filter(Boolean).join(": ");
    if (detail) return `${err.message} (${detail})`;
  }
  return err.message;
}

/**
 * Resolve a cached M2M bearer header for calling deployd-api. Single source of
 * credential resolution (spec 215 FR-007): reads OIDC_M2M_CLIENT_ID/SECRET from
 * the CSI secrets mount or env (LOGTO_* fallback), then delegates to the shared
 * token cache in oidcM2m.ts. Throws with a specific diagnostic when config or
 * credentials are absent.
 */
export async function getDeploydAuthHeader(): Promise<string> {
  if (!OIDC_ENDPOINT || !DEPLOYD_AUDIENCE) {
    throw new Error("Missing OIDC_ENDPOINT or DEPLOYD_AUDIENCE");
  }

  const clientId =
    (await readSecretFromDir("OIDC_M2M_CLIENT_ID")) ??
    process.env.OIDC_M2M_CLIENT_ID ??
    (await readSecretFromDir("LOGTO_M2M_CLIENT_ID")) ??
    process.env.LOGTO_M2M_CLIENT_ID ??
    "";
  const clientSecret =
    (await readSecretFromDir("OIDC_M2M_CLIENT_SECRET")) ??
    process.env.OIDC_M2M_CLIENT_SECRET ??
    (await readSecretFromDir("LOGTO_M2M_CLIENT_SECRET")) ??
    process.env.LOGTO_M2M_CLIENT_SECRET ??
    "";

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing OIDC_M2M_CLIENT_ID or OIDC_M2M_CLIENT_SECRET in secrets mount or env"
    );
  }

  return getCachedDeploydAuthHeader({
    oidcEndpoint: OIDC_ENDPOINT,
    resource: DEPLOYD_AUDIENCE,
    scope: DEPLOYD_SCOPE || undefined,
    clientId,
    clientSecret,
    skewSeconds: 30,
  });
}

/** Whether deployd-api credentials are configured (false in local dev). */
export function isDeploydConfigured(): boolean {
  return !!(OIDC_ENDPOINT && DEPLOYD_AUDIENCE);
}

export type DeploydDeploymentResult = {
  release_id: string;
  status: string;
};

/**
 * Create a deployment via deployd-api-rs POST /v1/deployments.
 * Throws on HTTP or auth errors.
 */
export async function createPreviewDeployment(opts: {
  tenant_id: string;
  app_id: string;
  env_id: string;
  release_sha: string;
  artifact_ref: string;
  lane: string;
}): Promise<DeploydDeploymentResult> {
  const authHeader = await getDeploydAuthHeader();
  const resp = await fetch(`${DEPLOYD_URL}/v1/deployments`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: authHeader },
    body: JSON.stringify(opts),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`deployd-api create failed: ${resp.status} ${text}`);
  }

  return (await resp.json()) as DeploydDeploymentResult;
}

/**
 * Destroy a preview deployment via deployd-api DELETE /v1/deployments/:id.
 * Tears down K8s resources and marks the deployment as DESTROYED.
 */
export async function destroyPreviewDeployment(releaseId: string): Promise<void> {
  if (!isDeploydConfigured()) {
    log.info("Preview destroy requested (no deployd configured)", { releaseId });
    return;
  }

  const authHeader = await getDeploydAuthHeader();
  const resp = await fetch(`${DEPLOYD_URL}/v1/deployments/${releaseId}`, {
    method: "DELETE",
    headers: { authorization: authHeader },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`deployd-api delete failed: ${resp.status} ${text}`);
  }

  log.info("Preview deployment destroyed", { releaseId });
}

/** Outcome of a deployd-api create dispatch (spec 215 FR-002 trigger path). */
export interface DeploydDispatchResult {
  ok: boolean;
  httpStatus: number;
  /** deployd's `rel_<uuid>`; may be present even on a non-ok idempotent reply. */
  releaseId: string | null;
  /** deployd's terminal status (ROLLED_OUT / FAILED / ...); null on transport error. */
  status: string | null;
  endpoints: string[];
  /** Verbatim error body on a non-ok response; null on success. */
  diagnostic: string | null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Dispatch a fully-assembled deployment body to deployd-api (spec 215 FR-002).
 * deployd's create is synchronous (helm runs inline), so the response carries
 * the terminal status and live endpoints. Never throws on an HTTP error; the
 * non-ok branch is reported in the result so the caller can record a FAILED
 * row with the diagnostic. A thrown error (transport down) is the caller's
 * REQUEST_FAILED signal.
 */
export async function dispatchDeployment(
  body: Record<string, unknown>,
): Promise<DeploydDispatchResult> {
  const authHeader = await getDeploydAuthHeader();
  const resp = await fetch(`${DEPLOYD_URL}/v1/deployments`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: authHeader },
    body: JSON.stringify(body),
  });

  const text = await resp.text();
  let parsed: Record<string, unknown> = {};
  try {
    const j: unknown = JSON.parse(text);
    if (j && typeof j === "object") parsed = j as Record<string, unknown>;
  } catch {
    parsed = { raw: text };
  }

  if (!resp.ok) {
    return {
      ok: false,
      httpStatus: resp.status,
      releaseId: asString(parsed.release_id),
      status: null,
      endpoints: [],
      diagnostic: asString(parsed.message) ?? text,
    };
  }

  return {
    ok: true,
    httpStatus: resp.status,
    releaseId: asString(parsed.release_id),
    status: asString(parsed.status),
    endpoints: asStringArray(parsed.endpoints),
    diagnostic: null,
  };
}

/** A point-in-time status read from deployd-api (spec 215 FR-008 reconcile). */
export interface DeploydStatusResult {
  status: string;
  /** The status endpoint returns `events`, not endpoints; this stays undefined. */
  endpoints?: string[];
  /**
   * Message of the most recent `failed` event, when present. deployd records
   * the real cause in a `failed` deployment event (e.g. `helm install
   * failed: <helm stderr>`); surfacing it lets statecraft store an actionable
   * diagnostic instead of a generic "see deployd logs" pointer.
   */
  failedReason?: string;
}

/**
 * Pull the message of the latest `failed` event from deployd's status
 * payload. Events arrive ordered by id ascending, so the last match wins.
 */
function latestFailedEventMessage(events: unknown): string | undefined {
  if (!Array.isArray(events)) return undefined;
  let message: string | undefined;
  for (const e of events) {
    if (e && typeof e === "object") {
      const ev = e as Record<string, unknown>;
      if (ev.event_type === "failed" && typeof ev.message === "string") {
        message = ev.message;
      }
    }
  }
  return message;
}

/**
 * Read current status from deployd-api `GET /v1/deployments/:id/status`
 * (spec 215 FR-008). Returns null for an unknown release id (404); throws on
 * other transport errors so the caller can leave the record untouched.
 */
export async function getDeploymentStatus(
  releaseId: string,
): Promise<DeploydStatusResult | null> {
  const authHeader = await getDeploydAuthHeader();
  const resp = await fetch(`${DEPLOYD_URL}/v1/deployments/${releaseId}/status`, {
    method: "GET",
    headers: { authorization: authHeader },
  });

  if (resp.status === 404) return null;
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`deployd-api status failed: ${resp.status} ${text}`);
  }

  const parsed = (await resp.json()) as { status?: unknown; events?: unknown };
  const status = asString(parsed.status);
  if (!status) return null;
  const failedReason = latestFailedEventMessage(parsed.events);
  return failedReason ? { status, failedReason } : { status };
}
