/**
 * Server-side PAT API helpers (spec 106 FR-007).
 *
 * Calls the /auth/pat endpoints from /platform/services/statecraft/api/auth/pat.ts
 * over direct fetch so the SSR loaders/actions can forward the session cookie.
 */

const DEFAULT_API_BASE = "http://localhost:4000";

// SSR runs in the same pod as the Encore API. Calling back via the public
// hostname is a pointless trip through Cloudflare + ingress and drops the
// Cookie header when HTTP is upgraded to HTTPS mid-flight. Loop back via
// localhost:4000 instead.
function getBaseUrl(_request: Request): string {
  return process.env.ENCORE_API_BASE_URL ?? DEFAULT_API_BASE;
}

export interface PatMetadata {
  exists: boolean;
  tokenPrefix?: string;
  isFineGrained?: boolean;
  scopes?: string[];
  lastUsedAt?: string;
  lastCheckedAt?: string;
  createdAt?: string;
}

export interface PatValidationResult {
  ok: boolean;
  tokenPrefix: string;
  isFineGrained: boolean;
  scopes: string[];
  lastCheckedAt: string;
  githubLogin?: string;
  reason?: "pat_invalid" | "pat_rate_limited" | "pat_saml_not_authorized";
}

async function apiFetch<T>(request: Request, path: string, init?: RequestInit): Promise<T> {
  const base = getBaseUrl(request);
  const cookie = request.headers.get("Cookie") ?? "";
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(cookie && { Cookie: cookie }),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `API error: ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function getPat(request: Request): Promise<PatMetadata> {
  return apiFetch<PatMetadata>(request, "/auth/pat");
}

export async function storePat(request: Request, token: string): Promise<PatValidationResult> {
  return apiFetch<PatValidationResult>(request, "/auth/pat", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export async function revokePat(request: Request): Promise<{ revoked: boolean }> {
  return apiFetch<{ revoked: boolean }>(request, "/auth/pat", { method: "DELETE" });
}

export async function validatePat(request: Request): Promise<PatValidationResult> {
  return apiFetch<PatValidationResult>(request, "/auth/pat/validate", { method: "POST" });
}
