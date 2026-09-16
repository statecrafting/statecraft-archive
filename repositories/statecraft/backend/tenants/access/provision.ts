/**
 * Self-serve tenant provisioning from an install (spec 011 §5.6).
 *
 * Two entry paths converge here. The setup callback (a tenant-less install URL)
 * knows the installing app user; a direct install from GitHub's App page
 * arrives only as an `installation.created` webhook and knows the installer
 * only by GitHub id. Both create a tenant named after the org, bind the
 * installation, and grant the installer an `admin` membership: keyed by
 * `userAccountId` for the callback path, by `githubUserId` (pending, attaches
 * at login) for the webhook path.
 *
 * Both paths guard the setup/webhook race by reusing an installation that the
 * other path may already have created (installation id is unique).
 */
import { logInfo } from "../../lib/logger";
import {
  createTenantForOrg,
  findInstallationById,
  upsertInstallation,
} from "../store";

import { upsertMembership } from "./store";

/** Grant the installing app user an admin membership (setup-callback path). */
export async function grantInstallMembership(
  tenantId: string,
  userAccountId: string,
): Promise<void> {
  await upsertMembership({ tenantId, userAccountId, role: "admin", source: "install" });
}

/**
 * Resolve the tenant for a tenant-less install: reuse the installation's tenant
 * if a webhook already created it, else create a fresh tenant owned by the
 * installing user.
 */
export async function tenantForInstall(
  installationId: string,
  githubOrg: string,
  ownerUserId: string,
): Promise<string> {
  const existing = await findInstallationById(installationId);
  if (existing) return existing.tenantId;
  const tenant = await createTenantForOrg(githubOrg, ownerUserId);
  return tenant.id;
}

/**
 * Provision a tenant from a direct-from-GitHub install (webhook path). No app
 * user is bound yet, so the tenant is ownerless and access comes from a pending
 * admin membership keyed by the installer's GitHub id.
 */
export async function autoProvisionFromInstall(input: {
  installationId: string;
  githubOrg: string;
  senderGithubId: string;
}): Promise<void> {
  const existing = await findInstallationById(input.installationId);
  const tenantId = existing
    ? existing.tenantId
    : (await createTenantForOrg(input.githubOrg, "")).id;
  await upsertInstallation({
    tenantId,
    githubOrg: input.githubOrg,
    installationId: input.installationId,
    status: "active",
  });
  if (input.senderGithubId) {
    await upsertMembership({
      tenantId,
      githubUserId: input.senderGithubId,
      role: "admin",
      source: "install",
    });
  }
  logInfo("access.auto_provisioned", { installationId: input.installationId });
}
