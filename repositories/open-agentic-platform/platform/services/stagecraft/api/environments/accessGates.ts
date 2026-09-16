// Spec 137 Phase 2 — Statecraft API for per-environment access gates.
//
// Four endpoints + audit-log integration + defense-in-depth password
// rejection (FR-007). Storage layer is spec 137 Phase 1 migration 40
// (`environment_access_gates` + `environment_access_gate_allowlist_emails`).
//
// The descriptor is 1:1 with environments — the GET returns either a
// default-disabled descriptor (no row exists yet) or the persisted row.
// PUT is a true upsert. Allowlist endpoints append / remove rows by id.
//
// Permission gate: `org:manage_members` (owner + admin in the project's
// org). Mirrors the admin-only intent in spec.md §"Explicitly in scope"
// and the §"Out of scope" carve-out for self-service flows. A tighter
// per-environment gate is a future refinement when spec 137 §Out of
// scope §"Email allowlist UX for non-administrators" gets its own spec.

import { randomBytes } from "node:crypto";
import { api, APIError } from "encore.dev/api";
import log from "encore.dev/log";
import { getAuthData } from "~encore/auth";
import { and, eq } from "drizzle-orm";
import { db } from "../db/drizzle";
import {
  auditLog,
  environments,
  environmentAccessGates,
  environmentAccessGateAllowlistEmails,
  projects,
} from "../db/schema";
import { hasOrgPermission } from "../auth/membership";
import { provisionRauthyUser } from "../auth/rauthy";
import {
  deprovisionTenantGateClient,
  fetchRauthyClientSecret,
  provisionTenantGateClient,
  tenantGateClientId,
} from "../auth/rauthyAdminClients";
import {
  ALLOWLIST_KINDS,
  assertNoPasswordFields,
  validateFederatedProviderPair,
  type FederatedProvider,
} from "./accessGatesHelpers";

/**
 * 32 random bytes, base64-encoded — oauth2-proxy's required cookie-secret
 * shape. Generated once when the gate first transitions to enabled and
 * retained across deploys so user sessions survive rolling helm upgrades.
 */
function generateCookieSecret(): string {
  return randomBytes(32).toString("base64");
}

export { assertNoPasswordFields, type FederatedProvider } from "./accessGatesHelpers";

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

export interface AccessGateDescriptor {
  enabled: boolean;
  rauthyClientRef: string | null;
  /**
   * Name of the K8s Secret in the tenant namespace that holds the
   * wildcard TLS material. Defaults to "tenants-wildcard-tls" on insert;
   * exposed in GET so the UI can show / let admins override.
   *
   * Note: the secret itself is replicated into tenant namespaces by
   * kubernetes-reflector (see `platform/infra/hetzner/manifests/
   * tenants-wildcard-certificate.yaml`); statecraft only stores the name.
   */
  tlsSecretName: string;
  loginMethodMagicLink: boolean;
  loginMethodFederatedProvider: FederatedProvider | null;
  loginMethodFederatedProviderClientRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccessGateAllowlistEntry {
  id: string;
  kind: "email" | "domain";
  value: string;
  createdAt: string;
}

export interface AccessGateRead extends AccessGateDescriptor {
  environmentId: string;
  allowlist: AccessGateAllowlistEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the environment + its owning project's org, scoped to the
 * caller's org. Returns the environment row when in-scope, throws
 * `NotFound` otherwise.
 *
 * Centralised so each endpoint enforces the same org-scoping contract;
 * spec 119 §6 collapsed workspace into project so the chain is
 * `environment → project → organization`.
 */
async function loadEnvironmentInOrg(
  environmentId: string,
  orgId: string,
): Promise<{ id: string; projectId: string }> {
  const [row] = await db
    .select({
      id: environments.id,
      projectId: environments.projectId,
    })
    .from(environments)
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .where(and(eq(environments.id, environmentId), eq(projects.orgId, orgId)))
    .limit(1);
  if (!row) {
    throw APIError.notFound("environment not found in this org");
  }
  return row;
}

function defaultDisabledDescriptor(): AccessGateDescriptor {
  const now = new Date().toISOString();
  return {
    enabled: false,
    rauthyClientRef: null,
    tlsSecretName: "tenants-wildcard-tls",
    loginMethodMagicLink: true,
    loginMethodFederatedProvider: null,
    loginMethodFederatedProviderClientRef: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function fetchAllowlist(
  environmentId: string,
): Promise<AccessGateAllowlistEntry[]> {
  const rows = await db
    .select({
      id: environmentAccessGateAllowlistEmails.id,
      kind: environmentAccessGateAllowlistEmails.kind,
      value: environmentAccessGateAllowlistEmails.value,
      createdAt: environmentAccessGateAllowlistEmails.createdAt,
    })
    .from(environmentAccessGateAllowlistEmails)
    .where(eq(environmentAccessGateAllowlistEmails.environmentId, environmentId));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as "email" | "domain",
    value: r.value,
    createdAt: r.createdAt.toISOString(),
  }));
}

async function emitAudit(
  actorUserId: string,
  action: string,
  environmentId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await db.insert(auditLog).values({
    actorUserId,
    action,
    targetType: "environment_access_gate",
    targetId: environmentId,
    metadata,
  });
}

// ---------------------------------------------------------------------------
// GET /api/environments/:environmentId/access-gate
// ---------------------------------------------------------------------------

export interface GetAccessGateRequest {
  environmentId: string;
}

export const getAccessGate = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/environments/:environmentId/access-gate",
  },
  async (req: GetAccessGateRequest): Promise<AccessGateRead> => {
    const auth = getAuthData()!;
    const env = await loadEnvironmentInOrg(req.environmentId, auth.orgId);

    const [row] = await db
      .select()
      .from(environmentAccessGates)
      .where(eq(environmentAccessGates.environmentId, env.id))
      .limit(1);

    const allowlist = await fetchAllowlist(env.id);
    if (!row) {
      // No descriptor persisted yet — surface a default-disabled view so
      // the UI's "Access gate" card can render the off-state without a
      // separate 404 path.
      return {
        environmentId: env.id,
        ...defaultDisabledDescriptor(),
        allowlist,
      };
    }

    return {
      environmentId: env.id,
      enabled: row.enabled,
      rauthyClientRef: row.rauthyClientRef,
      tlsSecretName: row.tlsSecretName,
      loginMethodMagicLink: row.loginMethodMagicLink,
      loginMethodFederatedProvider:
        row.loginMethodFederatedProvider as FederatedProvider | null,
      loginMethodFederatedProviderClientRef:
        row.loginMethodFederatedProviderClientRef,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      allowlist,
    };
  },
);

// ---------------------------------------------------------------------------
// PUT /api/environments/:environmentId/access-gate
// ---------------------------------------------------------------------------

export interface PutAccessGateRequest {
  environmentId: string;
  enabled: boolean;
  /**
   * Optional override for the TLS secret name. Defaults to
   * "tenants-wildcard-tls" (the cluster wildcard cert from spec 106 §12.4).
   */
  tlsSecretName?: string;
  loginMethodMagicLink?: boolean;
  loginMethodFederatedProvider?: FederatedProvider | null;
  loginMethodFederatedProviderClientRef?: string | null;
}

export const putAccessGate = api(
  {
    expose: true,
    auth: true,
    method: "PUT",
    path: "/api/environments/:environmentId/access-gate",
  },
  async (req: PutAccessGateRequest): Promise<AccessGateRead> => {
    const auth = getAuthData()!;
    if (!hasOrgPermission(auth.platformRole, "org:manage_members")) {
      throw APIError.permissionDenied(
        "Insufficient permissions to manage access gates",
      );
    }
    assertNoPasswordFields(req);

    const env = await loadEnvironmentInOrg(req.environmentId, auth.orgId);

    // Validate federated-provider value + pair-consistency before
    // hitting the DB so the error surface is precise. The CHECK
    // constraints would also fire, but the typed errors from the
    // helper layer are more actionable.
    const { provider: fedProvider, clientRef: fedRef } =
      validateFederatedProviderPair(
        req.loginMethodFederatedProvider,
        req.loginMethodFederatedProviderClientRef,
      );

    const magicLink = req.loginMethodMagicLink ?? true;
    const now = new Date();

    // Load current state so we can decide what to do in Rauthy. The
    // descriptor is 1:1 keyed on environment_id; absence means
    // "currently disabled."
    const [current] = await db
      .select()
      .from(environmentAccessGates)
      .where(eq(environmentAccessGates.environmentId, env.id))
      .limit(1);
    const wasEnabled = current?.enabled === true;

    // ---- Rauthy reconciliation (Phase 3 wiring) -------------------------
    // The descriptor row's `rauthy_client_ref` is the source of truth for
    // whether a Rauthy client exists. Three branches:
    //
    //   1. enable (false → true) OR descriptor edit (true → true):
    //      provisionTenantGateClient (idempotent create-or-update).
    //   2. disable (true → false): deprovisionTenantGateClient
    //      (best-effort — DB always wins for the descriptor's own state).
    //   3. no-op (false → false): no Rauthy work.
    //
    // The hostname here is a placeholder; Phase 4 (deployd-api K8s
    // renderer) re-provisions the client with the real ingress hostname
    // at deploy time. The PUT is idempotent, so the Phase 4 update
    // overlays cleanly without recreating the client.
    let rauthyClientRef: string | null = current?.rauthyClientRef ?? null;
    // Phase 4↔5 integration / migration 41: the descriptor row now carries
    // the Rauthy client secret + the oauth2-proxy cookie secret. Both are
    // required NOT NULL when `enabled = true` (CHECK enabled_requires_secrets).
    //
    // Persistence rules:
    //   - rauthyClientSecret is captured ONCE at provision time (Rauthy
    //     0.35 admin GET never returns it; T003 readback). On "updated"
    //     the existing secret remains valid — we keep `current?.rauthyClientSecret`.
    //   - cookieSecret is generated by statecraft on first transition to
    //     enabled and reused on subsequent updates so user sessions
    //     survive helm upgrades.
    let rauthyClientSecret: string | null = current?.rauthyClientSecret ?? null;
    let cookieSecret: string | null = current?.cookieSecret ?? null;
    if (req.enabled) {
      const clientId = tenantGateClientId(env.id);
      const gateSpec = {
        clientId,
        name: `Tenant Gate - ${env.id}`,
        tenantHostname: `${env.id}.tenants.placeholder.example.com`,
        magicLinkEnabled: magicLink,
        federatedProvider: fedProvider,
      };
      try {
        const provision = await provisionTenantGateClient(gateSpec);
        rauthyClientRef = provision.clientId;
        if (provision.action === "created") {
          rauthyClientSecret = provision.clientSecret;
        }
        // On "updated", retain the existing rauthyClientSecret. If we have
        // none (the Rauthy client exists but statecraft never persisted its
        // secret, e.g. an earlier enable left an orphaned client after the
        // name-validation 400, or a partial enable), self-heal. Rauthy 0.35
        // exposes a confidential client's secret via
        // POST /auth/v1/clients/{id}/secret, so recover it non-destructively
        // first. Only if that yields nothing do we fall back to delete +
        // recreate (which rotates the secret and is the heavier operation).
        // Idempotent: deprovision treats a missing client as success.
        if (!rauthyClientSecret) {
          log.warn(
            "tenant gate: existing Rauthy client has no persisted secret; recovering",
            { environmentId: env.id, clientId },
          );
          rauthyClientSecret = await fetchRauthyClientSecret(clientId);
          if (!rauthyClientSecret) {
            log.warn(
              "tenant gate: secret endpoint returned nothing; recreating client",
              { environmentId: env.id, clientId },
            );
            await deprovisionTenantGateClient(clientId);
            const recreated = await provisionTenantGateClient(gateSpec);
            rauthyClientRef = recreated.clientId;
            rauthyClientSecret = recreated.clientSecret;
            if (recreated.action !== "created" || !rauthyClientSecret) {
              throw new Error(
                `tenant gate client recreate did not yield a secret ` +
                  `(action='${recreated.action}'); cannot satisfy ` +
                  `enabled_requires_secrets CHECK`,
              );
            }
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        throw APIError.unavailable(
          `Rauthy admin call failed; gate not enabled: ${msg}`,
        );
      }
      // Generate cookie secret on first enable; reuse on subsequent
      // updates so oauth2-proxy doesn't sign-out every user.
      if (!cookieSecret) {
        cookieSecret = generateCookieSecret();
      }
    }
    // ---------------------------------------------------------------------

    const tlsSecretName =
      req.tlsSecretName ?? current?.tlsSecretName ?? "tenants-wildcard-tls";

    // Upsert via ON CONFLICT — the descriptor is 1:1 keyed on
    // environment_id so this resolves to insert-or-update on the same
    // row deterministically.
    const inserted = await db
      .insert(environmentAccessGates)
      .values({
        environmentId: env.id,
        enabled: req.enabled,
        rauthyClientRef: req.enabled ? rauthyClientRef : null,
        rauthyClientSecret: req.enabled ? rauthyClientSecret : null,
        cookieSecret: req.enabled ? cookieSecret : null,
        tlsSecretName,
        loginMethodMagicLink: magicLink,
        loginMethodFederatedProvider: fedProvider,
        loginMethodFederatedProviderClientRef: fedRef,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: environmentAccessGates.environmentId,
        set: {
          enabled: req.enabled,
          rauthyClientRef: req.enabled ? rauthyClientRef : null,
          rauthyClientSecret: req.enabled ? rauthyClientSecret : null,
          cookieSecret: req.enabled ? cookieSecret : null,
          tlsSecretName,
          loginMethodMagicLink: magicLink,
          loginMethodFederatedProvider: fedProvider,
          loginMethodFederatedProviderClientRef: fedRef,
          updatedAt: now,
        },
      })
      .returning();

    // After the DB write, deprovision Rauthy if we transitioned to
    // disabled. Order matters: DB first so the descriptor reflects the
    // requested state even if Rauthy deprovision fails. An orphan
    // Rauthy client is reconcilable by a later admin pass; a DB row
    // claiming "enabled with a now-invalid client_ref" is not.
    if (wasEnabled && !req.enabled && current?.rauthyClientRef) {
      try {
        await deprovisionTenantGateClient(current.rauthyClientRef);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        log.warn(
          "rauthy.tenant_gate.client.deprovision_failed_post_disable",
          { clientId: current.rauthyClientRef, error: msg },
        );
      }
    }

    const row = inserted[0]!;
    await emitAudit(
      auth.userID,
      req.enabled
        ? "tenant.gate.descriptor.enabled"
        : "tenant.gate.descriptor.disabled",
      env.id,
      {
        enabled: req.enabled,
        rauthyClientRef: req.enabled ? rauthyClientRef : null,
        loginMethodMagicLink: magicLink,
        loginMethodFederatedProvider: fedProvider,
      },
    );

    const allowlist = await fetchAllowlist(env.id);
    return {
      environmentId: env.id,
      enabled: row.enabled,
      rauthyClientRef: row.rauthyClientRef,
      tlsSecretName: row.tlsSecretName,
      loginMethodMagicLink: row.loginMethodMagicLink,
      loginMethodFederatedProvider:
        row.loginMethodFederatedProvider as FederatedProvider | null,
      loginMethodFederatedProviderClientRef:
        row.loginMethodFederatedProviderClientRef,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      allowlist,
    };
  },
);

// ---------------------------------------------------------------------------
// POST /api/environments/:environmentId/access-gate/allowlist
// ---------------------------------------------------------------------------

export interface AddAllowlistEntryRequest {
  environmentId: string;
  kind: "email" | "domain";
  value: string;
}

export interface AddAllowlistEntryResponse {
  id: string;
  kind: "email" | "domain";
  value: string;
  createdAt: string;
}

export const addAllowlistEntry = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/environments/:environmentId/access-gate/allowlist",
  },
  async (req: AddAllowlistEntryRequest): Promise<AddAllowlistEntryResponse> => {
    const auth = getAuthData()!;
    if (!hasOrgPermission(auth.platformRole, "org:manage_members")) {
      throw APIError.permissionDenied(
        "Insufficient permissions to manage access gate allowlist",
      );
    }
    assertNoPasswordFields(req);

    const env = await loadEnvironmentInOrg(req.environmentId, auth.orgId);

    if (!ALLOWLIST_KINDS.has(req.kind)) {
      throw APIError.invalidArgument("kind must be 'email' or 'domain'");
    }
    const value = req.value?.trim() ?? "";
    if (!value) {
      throw APIError.invalidArgument("value must be a non-empty string");
    }
    // Normalise to lowercase on write; the unique index uses
    // `lower(value)` so case-mismatched duplicates would collide there,
    // but storing lowercased values keeps the read path predictable too.
    const normalised = value.toLowerCase();

    let inserted;
    try {
      inserted = await db
        .insert(environmentAccessGateAllowlistEmails)
        .values({
          environmentId: env.id,
          kind: req.kind,
          value: normalised,
        })
        .returning();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("environment_access_gate_allowlist_emails_unique")) {
        throw APIError.alreadyExists(
          `allowlist entry already exists for kind='${req.kind}' value='${normalised}'`,
        );
      }
      throw err;
    }

    const row = inserted[0]!;

    // FR-008 / clarifications-resolved §Decision 5 — auto-provision a
    // Rauthy user when:
    //   * the entry is an email (not a domain — domains materialise on
    //     first federated login per Rauthy's silent-link path), AND
    //   * the descriptor has magic_link enabled (no provisioning when
    //     only federated is configured).
    // Failure is logged but does NOT roll back the allowlist row —
    // Rauthy user provisioning is best-effort; an absent user surfaces
    // on first login attempt rather than at descriptor edit time, and
    // the allowlist row remains accurate to the operator's intent.
    if (req.kind === "email") {
      const [descriptor] = await db
        .select({
          loginMethodMagicLink: environmentAccessGates.loginMethodMagicLink,
        })
        .from(environmentAccessGates)
        .where(eq(environmentAccessGates.environmentId, env.id))
        .limit(1);
      if (descriptor?.loginMethodMagicLink) {
        try {
          await provisionRauthyUser({ email: normalised, name: normalised });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          log.warn("rauthy.tenant_gate.user.provision_failed", {
            email: normalised,
            environmentId: env.id,
            error: msg,
          });
        }
      }
    }

    await emitAudit(
      auth.userID,
      "tenant.gate.allowlist.added",
      env.id,
      { kind: req.kind, value: normalised, entryId: row.id },
    );

    return {
      id: row.id,
      kind: row.kind as "email" | "domain",
      value: row.value,
      createdAt: row.createdAt.toISOString(),
    };
  },
);

// ---------------------------------------------------------------------------
// DELETE /api/environments/:environmentId/access-gate/allowlist/:entryId
// ---------------------------------------------------------------------------

export interface RemoveAllowlistEntryRequest {
  environmentId: string;
  entryId: string;
}

export interface RemoveAllowlistEntryResponse {
  ok: true;
  removed: AccessGateAllowlistEntry | null;
}

export const removeAllowlistEntry = api(
  {
    expose: true,
    auth: true,
    method: "DELETE",
    path: "/api/environments/:environmentId/access-gate/allowlist/:entryId",
  },
  async (
    req: RemoveAllowlistEntryRequest,
  ): Promise<RemoveAllowlistEntryResponse> => {
    const auth = getAuthData()!;
    if (!hasOrgPermission(auth.platformRole, "org:manage_members")) {
      throw APIError.permissionDenied(
        "Insufficient permissions to manage access gate allowlist",
      );
    }
    const env = await loadEnvironmentInOrg(req.environmentId, auth.orgId);

    const deleted = await db
      .delete(environmentAccessGateAllowlistEmails)
      .where(
        and(
          eq(environmentAccessGateAllowlistEmails.id, req.entryId),
          eq(environmentAccessGateAllowlistEmails.environmentId, env.id),
        ),
      )
      .returning();

    if (deleted.length === 0) {
      // Surface absence as `removed: null` (not 404) — the caller asked
      // "make sure this entry is gone" and that state holds regardless of
      // whether the row was already absent. Mirror of FR-009-style
      // idempotent toggling.
      return { ok: true, removed: null };
    }

    const row = deleted[0]!;
    await emitAudit(
      auth.userID,
      "tenant.gate.allowlist.removed",
      env.id,
      { kind: row.kind, value: row.value, entryId: row.id },
    );

    return {
      ok: true,
      removed: {
        id: row.id,
        kind: row.kind as "email" | "domain",
        value: row.value,
        createdAt: row.createdAt.toISOString(),
      },
    };
  },
);
