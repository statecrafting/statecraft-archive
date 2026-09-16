/**
 * Thin typed client over the statecraft control-plane API (spec 007).
 *
 * Auth rides httpOnly cookies, so every request is plain fetch with
 * same-origin credentials; nothing token-like is ever visible to this code.
 * Mutating calls replay the CSRF token from GET /api/v1/auth/csrf-token as the
 * X-CSRF-Token header (double-submit; the csrf_token cookie is httpOnly, so the
 * response body is the only readable source of the value). GET calls silently
 * retry once through /api/v1/auth/refresh on an expired-access-token 401.
 *
 * Namespaces: /api/v1/auth/* is THIS app's auth service; the bare /auth/* prefix
 * is the rauthy reverse-proxy (idp service) and is never called from here.
 *
 * Response shapes are copied faithfully from the service code (specs 004/005);
 * the fleet shapes (spec 006) target endpoints that may not be mounted yet, so
 * their callers degrade on 404 (see degradeOn404).
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let code: string | null = null;
  let message = `${res.status} ${res.statusText}`.trim();
  try {
    const body = (await res.json()) as { code?: string; message?: string };
    if (body.code) code = body.code;
    if (body.message) message = body.message;
  } catch {
    // Non-JSON error body (e.g. a proxy 502): keep the status line.
  }
  return new ApiError(res.status, code, message);
}

async function refresh(): Promise<boolean> {
  const res = await fetch("/api/v1/auth/refresh", {
    method: "POST",
    credentials: "same-origin",
  });
  return res.ok;
}

/** GET JSON, with one silent refresh-retry on an expired-token 401. */
export async function apiGet<T>(path: string): Promise<T> {
  let res = await fetch(path, { credentials: "same-origin" });
  if (res.status === 401 && (await refresh())) {
    res = await fetch(path, { credentials: "same-origin" });
  }
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

async function csrfToken(): Promise<string> {
  const { token } = await apiGet<{ token: string }>("/api/v1/auth/csrf-token");
  return token;
}

type MutatingMethod = "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Mutating request: a fresh CSRF token is fetched per call (the token cookie is
 * httpOnly, so we cannot read a cached one), with one refresh-retry on a 401.
 */
export async function apiSend<T>(
  method: MutatingMethod,
  path: string,
  body?: unknown,
): Promise<T> {
  // Encore decodes DELETE payloads from the query string, not the body; a JSON
  // body on DELETE fails with "unable to decode query string".
  let url = path;
  let payload = body;
  if (method === "DELETE" && body !== undefined) {
    const qs = new URLSearchParams(
      Object.entries(body as Record<string, unknown>)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => [k, String(v)]),
    ).toString();
    if (qs) url += (url.includes("?") ? "&" : "?") + qs;
    payload = undefined;
  }
  const send = async (): Promise<Response> => {
    const token = await csrfToken();
    return fetch(url, {
      method,
      credentials: "same-origin",
      headers: {
        "X-CSRF-Token": token,
        ...(payload !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
    });
  };
  let res = await send();
  if (res.status === 401 && (await refresh())) {
    res = await send();
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/**
 * Graceful degradation: a service whose routes are not mounted answers 404.
 * Factory (005) is deployed; fleet (006) is not yet, so its callers wrap here
 * to render "not enabled yet" instead of crashing (spec 007 §2). Other errors
 * (401, 412, 5xx) still propagate to the route error boundary.
 */
export interface Degraded {
  enabled: false;
  reason: string;
}

export function isDegraded(value: unknown): value is Degraded {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Degraded).enabled === false
  );
}

export async function degradeOn404<T>(
  work: Promise<T>,
  service: string,
): Promise<T | Degraded> {
  try {
    return await work;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return { enabled: false, reason: `${service} is not enabled on this control plane yet.` };
    }
    throw err;
  }
}

// --- Auth (backend/auth, spec 002 chassis) ---------------------------------

export interface Me {
  id: string;
  email: string;
  name: string;
  roles: string[];
  ssoProvider: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AuthStatus {
  authenticated: boolean;
  drivers: string[];
}

/** The platform operator role (spec 011 §3); the first consumer of Me.roles. */
export const OPERATOR_ROLE = "statecraft_operator";

export function isOperator(me: Me): boolean {
  return me.roles.includes(OPERATOR_ROLE);
}

export const auth = {
  status: () => apiGet<AuthStatus>("/api/v1/auth/status"),
  drivers: () => apiGet<{ drivers: string[] }>("/api/v1/auth/drivers"),
  me: () => apiGet<Me>("/api/v1/auth/me"),
  logout: () => apiSend<{ redirectUrl: string }>("POST", "/api/v1/auth/logout"),
  // Explicit org-membership refresh (spec 011 §5.3).
  reconcile: () => apiSend<{ ok: boolean }>("POST", "/api/v1/auth/reconcile", {}),
};

// --- Tenants (backend/tenants, spec 004) -----------------------------------

export interface TenantView {
  id: string;
  name: string;
  ownerUserId: string;
  createdAt: string;
}

/** InstallationView.status: "active" | "suspended" | "removed". */
export interface InstallationView {
  id: string;
  tenantId: string;
  githubOrg: string;
  installationId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface RepoView {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  htmlUrl: string;
}

export interface TenantDetail {
  tenant: TenantView;
  installations: InstallationView[];
}

export const tenants = {
  list: () => apiGet<{ tenants: TenantView[] }>("/api/v1/tenants"),
  create: (name: string) => apiSend<TenantView>("POST", "/api/v1/tenants", { name }),
  get: (id: string) => apiGet<TenantDetail>(`/api/v1/tenants/${id}`),
  installUrl: (id: string) =>
    apiGet<{ url: string }>(`/api/v1/tenants/${id}/github/install-url`),
  // Tenant-less self-serve install URL (spec 011 §5.6): no tenant chosen, one
  // is created named after the org the user installs into.
  installUrlForUser: () => apiGet<{ url: string }>("/api/v1/github/install-url"),
  repos: (id: string) => apiGet<{ repos: RepoView[] }>(`/api/v1/tenants/${id}/repos`),
  // Lifecycle exits (spec 011 §5.4, §5.5).
  uninstall: (id: string) =>
    apiSend<InstallationView>("DELETE", `/api/v1/tenants/${id}/github/installation`),
  remove: (id: string, confirm: string) =>
    apiSend<{ deleted: boolean }>("DELETE", `/api/v1/tenants/${id}`, { confirm }),
};

// --- Operator console (backend/tenants/access, spec 011 §5.8) --------------

export interface OperatorTenantView {
  id: string;
  name: string;
  ownerUserId: string;
  createdAt: string;
  installationStatus: string;
  memberCount: number;
  fleetAppCount: number;
}

export const operator = {
  tenants: () => apiGet<{ tenants: OperatorTenantView[] }>("/api/v1/operator/tenants"),
  grantMembership: (id: string, githubUserId: string, role: "admin" | "member") =>
    apiSend<unknown>("POST", `/api/v1/operator/tenants/${id}/memberships`, {
      githubUserId,
      role,
    }),
  revokeMembership: (id: string, githubUserId: string) =>
    apiSend<{ revoked: boolean }>("DELETE", `/api/v1/operator/tenants/${id}/memberships`, {
      githubUserId,
    }),
};

// --- Factory (backend/factory, spec 005) -----------------------------------

export type StampStatus =
  | "queued"
  | "stamping"
  | "pushing"
  | "verifying"
  | "green"
  | "failed";

/** Terminal states end polling on the stamp-progress route. */
export const STAMP_TERMINAL: readonly StampStatus[] = ["green", "failed"];

export type Posture = "none" | "assisted" | "autonomous";

export interface StampJobView {
  id: string;
  tenantId: string;
  appName: string;
  org: string;
  templateRef: string;
  contractVersion: string;
  posture: string;
  status: string;
  certHash: string | null;
  checksRunId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateStampInput {
  appName: string;
  targetOrg: string;
  posture: Posture;
  // NOTE: the factory request type (spec 005) accepts `frontend`, but the
  // handler currently drops it: the stamped app always gets the template
  // contract's default frontend slot. We still send the operator's choice so
  // it lights up the moment 005 wires it through; the stamp form surfaces this
  // honestly rather than pretending the selection takes effect today.
  frontend?: string;
}

export const factory = {
  launch: (tenantId: string, input: CreateStampInput) =>
    apiSend<StampJobView>("POST", `/api/v1/tenants/${tenantId}/stamps`, input),
  job: (jobId: string) => apiGet<StampJobView>(`/api/v1/stamps/${jobId}`),
  list: (tenantId: string) =>
    apiGet<{ stamps: StampJobView[] }>(`/api/v1/tenants/${tenantId}/stamps`),
};

// --- Fleet (backend/fleet, spec 006, not yet mounted) ----------------------
// Endpoint shapes follow spec 006 §2. The per-tenant list endpoint the table
// needs is not enumerated there yet; targeting the natural REST path means the
// table lights up (or needs a one-line tweak) when 006 lands. Until then every
// call 404s and the route degrades. See degradeOn404.

export type FleetStatus = "placing" | "running" | "updating" | "failed" | "removed";

export interface FleetAppView {
  id: string;
  tenantId: string;
  stampJobId: string | null;
  name: string;
  namespace: string;
  image: string;
  volumeSize: string;
  host: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeployInput {
  name: string;
  image: string;
  volumeSize?: string;
  host?: string;
}

export const fleet = {
  list: (tenantId: string) =>
    apiGet<{ apps: FleetAppView[] }>(`/api/v1/tenants/${tenantId}/fleet`),
  status: (appId: string) => apiGet<FleetAppView>(`/api/v1/fleet/${appId}`),
  deploy: (tenantId: string, input: DeployInput) =>
    apiSend<FleetAppView>("POST", `/api/v1/tenants/${tenantId}/fleet`, input),
  update: (appId: string, image: string) =>
    apiSend<FleetAppView>("POST", `/api/v1/fleet/${appId}/update`, { image }),
  backup: (appId: string) =>
    apiSend<{ artifact?: string }>("POST", `/api/v1/fleet/${appId}/backup`, {}),
  remove: (appId: string, confirm: string) =>
    apiSend<void>("DELETE", `/api/v1/fleet/${appId}`, { confirm }),
};
