/**
 * Service-to-service OAuth client-credentials token cache (spec 004, INV-10).
 *
 * Returns a cached access token, refreshing it ahead of expiry (60s buffer) and
 * deduplicating concurrent fetches so a burst of proxied requests triggers a
 * single token request. The public caller's own token is never used here.
 */
import { env } from "../lib/env";
import { gatewayOAuthClientSecret } from "../lib/secrets";

interface CachedToken {
  token: string;
  expiresAt: number;
}

const EXPIRY_BUFFER_MS = 60_000;

let cached: CachedToken | undefined;
let inflight: Promise<string> | undefined;

export function isGatewayConfigured(): boolean {
  return Boolean(
    env.privateApiBaseUrl &&
      env.gatewayOAuthTokenUrl &&
      env.gatewayOAuthClientId &&
      gatewayOAuthClientSecret(),
  );
}

async function fetchToken(): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env.gatewayOAuthClientId!,
    client_secret: gatewayOAuthClientSecret(),
  });
  if (env.gatewayOAuthScope) body.set("scope", env.gatewayOAuthScope);

  const resp = await fetch(env.gatewayOAuthTokenUrl!, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!resp.ok) {
    throw new Error(`oauth token request failed: ${resp.status}`);
  }
  const json = (await resp.json()) as { access_token: string; expires_in?: number };
  const ttlMs = (json.expires_in ?? 3600) * 1000;
  cached = { token: json.access_token, expiresAt: Date.now() + ttlMs };
  return json.access_token;
}

export async function getAccessToken(): Promise<string> {
  if (cached && cached.expiresAt - EXPIRY_BUFFER_MS > Date.now()) {
    return cached.token;
  }
  if (inflight) return inflight;
  inflight = fetchToken().finally(() => {
    inflight = undefined;
  });
  return inflight;
}

/** Test/diagnostic helper: drop the cached token. */
export function resetTokenCache(): void {
  cached = undefined;
  inflight = undefined;
}
