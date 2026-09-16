// Spec 137 Phase 4↔5 integration — server-only helper that assembles
// the deployd-api `AccessGateDescriptor` wire shape from the
// `environment_access_gates` + `environment_access_gate_allowlist_emails`
// tables.
//
// Separate from `accessGates.ts` because this surface intentionally
// reads the secret columns (`rauthy_client_secret`, `cookie_secret`)
// that the public GET endpoint hides. Only callers on the deploy path
// (api/deploy/deploy.ts) import this — keeping the secret-touching
// query in its own file makes the audit + review surface easier to
// reason about than overloading the public GET handler with internal
// modes.

import { and, eq } from "drizzle-orm";
import log from "encore.dev/log";
import { db } from "../db/drizzle";
import {
  environmentAccessGates,
  environmentAccessGateAllowlistEmails,
} from "../db/schema";

/**
 * Wire shape consumed by deployd-api's `POST /v1/deployments`
 * `access_gate` field. Mirrors `AccessGateDescriptor` in
 * `platform/services/deployd-api-rs/src/helm.rs` exactly — keep the
 * field names + types in sync.
 *
 * `enabled: false` is encodable here too so a gate-toggle from on→off
 * can flow through the same deploy call without a separate "untoggle"
 * endpoint.
 */
export interface DeploydAccessGate {
  enabled: boolean;
  rauthy_issuer_url: string;
  rauthy_client_id: string;
  rauthy_client_secret: string;
  cookie_secret: string;
  allowed_emails: string[];
  allowed_domains: string[];
  tls_secret_name: string;
  proxy_service_port?: number;
}

/**
 * Load the gate descriptor + allowlist for an environment and assemble
 * the deployd-api wire shape. Returns:
 *
 *   - `null` when no descriptor row exists (no gate ever configured)
 *   - `{ enabled: false, ... }` when the descriptor exists but is off
 *   - `{ enabled: true, ... }` with all secrets populated when on
 *
 * The deploy caller forwards the value (or `null`) through to
 * deployd-api as `access_gate`. Deployd-api's `Option<AccessGateDescriptor>`
 * + `Default` impl handle the `null` case as "no gate" identically to
 * `enabled: false`.
 */
export async function loadDeployDescriptorForEnv(
  environmentId: string,
  rauthyIssuerUrl: string,
): Promise<DeploydAccessGate | null> {
  const [row] = await db
    .select()
    .from(environmentAccessGates)
    .where(eq(environmentAccessGates.environmentId, environmentId))
    .limit(1);
  if (!row) return null;

  if (!row.enabled) {
    return {
      enabled: false,
      rauthy_issuer_url: rauthyIssuerUrl,
      rauthy_client_id: "",
      rauthy_client_secret: "",
      cookie_secret: "",
      allowed_emails: [],
      allowed_domains: [],
      tls_secret_name: row.tlsSecretName,
    };
  }

  // Enabled: secrets MUST be present by the migration 41 CHECK. Treat
  // absence as a server-side invariant violation rather than silently
  // emitting an empty-secret descriptor — that would render a useless
  // oauth2-proxy that 401s every request.
  if (!row.rauthyClientRef || !row.rauthyClientSecret || !row.cookieSecret) {
    log.error("access_gate.deploy.descriptor.invariant_violation", {
      environmentId,
      hasClientRef: !!row.rauthyClientRef,
      hasClientSecret: !!row.rauthyClientSecret,
      hasCookieSecret: !!row.cookieSecret,
    });
    throw new Error(
      `access gate descriptor for env ${environmentId} is enabled but missing required secrets — ` +
        `CHECK enabled_requires_secrets should have prevented this row from existing`,
    );
  }

  const allowlistRows = await db
    .select({
      kind: environmentAccessGateAllowlistEmails.kind,
      value: environmentAccessGateAllowlistEmails.value,
    })
    .from(environmentAccessGateAllowlistEmails)
    .where(
      and(eq(environmentAccessGateAllowlistEmails.environmentId, environmentId)),
    );

  const allowed_emails: string[] = [];
  const allowed_domains: string[] = [];
  for (const r of allowlistRows) {
    if (r.kind === "email") allowed_emails.push(r.value);
    else if (r.kind === "domain") allowed_domains.push(r.value);
  }

  return {
    enabled: true,
    rauthy_issuer_url: rauthyIssuerUrl,
    rauthy_client_id: row.rauthyClientRef,
    rauthy_client_secret: row.rauthyClientSecret,
    cookie_secret: row.cookieSecret,
    allowed_emails,
    allowed_domains,
    tls_secret_name: row.tlsSecretName,
  };
}
