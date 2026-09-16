/**
 * Tenant lifecycle exits: uninstall (spec 011 §5.4) and delete (spec 011 §5.5).
 *
 * Teardown verbs never gate on an active installation (cleanup must always be
 * reachable), but tenant deletion is a privileged, irreversible act: it runs
 * through the spec 008 action gate and writes an attestation. An active
 * installation is uninstalled first, then the tenant, its installations, and
 * its memberships are hard-deleted in one ledger transaction; history survives
 * in the attestation ledger and audit log, not as soft-delete flags.
 */
import { APIError } from "encore.dev/api";
import { fleet, governance } from "~encore/clients";

import { ledger } from "../../core/ledger";
import { logError, logInfo } from "../../lib/logger";
import { GITHUB_API_BASE, GITHUB_API_VERSION } from "../config";
import { Installation, Tenant } from "../entities";
import { mintAppJwt } from "../github-app";
import { activeInstallationForTenant, installations, setInstallationStatus } from "../store";

import { TenantMembership } from "./entities";
import { gateOrDeny } from "./gate";

/** DELETE an installation on GitHub's side via the App JWT; 404 is idempotent success. */
async function githubDeleteInstallation(installationId: string): Promise<void> {
  const res = await fetch(
    `${GITHUB_API_BASE}/app/installations/${encodeURIComponent(installationId)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${mintAppJwt()}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        "User-Agent": "statecraft-control-plane",
      },
    },
  );
  if (!res.ok && res.status !== 404) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`delete installation ${installationId}: ${res.status} ${detail}`);
  }
}

/**
 * Uninstall the tenant's active installation (spec 011 §5.4): remove it on
 * GitHub, then mark it removed without waiting for the webhook (which arrives
 * too and is idempotent). Returns the updated row, or null when nothing was
 * linked.
 */
export async function uninstallForTenant(tenantId: string): Promise<Installation | null> {
  const inst = await activeInstallationForTenant(tenantId);
  if (!inst) return null;
  await githubDeleteInstallation(inst.installationId);
  await setInstallationStatus(inst.installationId, "removed");
  logInfo("access.uninstalled", { tenantId, installationId: inst.installationId });
  return installations().findById(inst.id);
}

/**
 * Delete a tenant (spec 011 §5.5). Refused while the tenant has fleet apps;
 * gated strict; uninstalls first if still linked; then a single-transaction
 * hard delete of the tenant, its installations, and its memberships.
 */
export async function deleteTenant(tenant: Tenant, actor: string): Promise<void> {
  const summary = await fleet.tenantAppSummary({ tenantId: tenant.id });
  if (summary.activeCount > 0) {
    throw APIError.failedPrecondition(
      `tenant has ${summary.activeCount} fleet app(s); remove them first`,
    );
  }

  const gated = await gateOrDeny("tenant_delete", { tenantId: tenant.id, name: tenant.name });

  // Uninstall the live link before the rows vanish (best-effort on GitHub's side
  // is not enough here: a failure must abort the delete so state stays truthful).
  await uninstallForTenant(tenant.id);

  await ledger().transaction(async ({ repo }) => {
    const instRepo = repo(Installation);
    const memRepo = repo(TenantMembership);
    for (const inst of await instRepo.findWhere({ tenantId: tenant.id } as Partial<Installation>)) {
      await instRepo.deleteById(inst.id);
    }
    for (const mem of await memRepo.findWhere({
      tenantId: tenant.id,
    } as Partial<TenantMembership>)) {
      await memRepo.deleteById(mem.id);
    }
    await repo(Tenant).deleteById(tenant.id);
  });

  try {
    await governance.record({
      kind: "tenant_delete",
      subject: tenant.id,
      actor,
      payload: { tenantId: tenant.id, name: tenant.name },
      ...(gated.configHash ? { configHash: gated.configHash } : {}),
    });
  } catch (err) {
    logError("access.delete_record_failed", { tenantId: tenant.id, err: String(err) });
  }
  logInfo("access.tenant_deleted", { tenantId: tenant.id });
}
