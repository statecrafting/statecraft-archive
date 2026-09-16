/**
 * Org-role derivation and membership dedup/attach (spec 011 §5.2, §5.3). The
 * derivation is pure; the store behaviour runs against the process-wide test
 * ledger with random ids so cases stay independent.
 */
import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { membershipRoleForOrgRole } from "./reconcile";
import {
  attachUserAccount,
  listMembershipsForTenant,
  membershipForUserAccount,
  upsertMembership,
} from "./store";

describe("membershipRoleForOrgRole", () => {
  it("maps org admin/member and rejects anything else", () => {
    expect(membershipRoleForOrgRole("admin")).toBe("admin");
    expect(membershipRoleForOrgRole("member")).toBe("member");
    expect(membershipRoleForOrgRole("billing_manager")).toBeNull();
    expect(membershipRoleForOrgRole(undefined)).toBeNull();
    expect(membershipRoleForOrgRole(null)).toBeNull();
  });
});

describe("membership dedup + attach", () => {
  it("converges an install grant and a later reconcile onto one row", async () => {
    const tenantId = randomUUID();
    const userAccountId = randomUUID();
    const githubUserId = `gh-${randomUUID()}`;

    // Install grant: keyed by app user, GitHub id unknown.
    await upsertMembership({ tenantId, userAccountId, role: "admin", source: "install" });
    // Reconcile: keyed by GitHub id for the same user + tenant.
    await upsertMembership({
      tenantId,
      githubUserId,
      userAccountId,
      role: "admin",
      source: "reconcile",
    });

    const rows = await listMembershipsForTenant(tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.githubUserId).toBe(githubUserId);
    expect(rows[0]!.userAccountId).toBe(userAccountId);
    expect(rows[0]!.role).toBe("admin");
  });

  it("attaches a pending webhook grant to the app user at login", async () => {
    const tenantId = randomUUID();
    const githubUserId = `gh-${randomUUID()}`;
    const userAccountId = randomUUID();

    // Direct-install webhook: pending row keyed by GitHub id only.
    await upsertMembership({ tenantId, githubUserId, role: "admin", source: "install" });
    expect(await membershipForUserAccount(tenantId, userAccountId)).toBeNull();

    // First login resolves the identity and attaches.
    await attachUserAccount(githubUserId, userAccountId);
    const attached = await membershipForUserAccount(tenantId, userAccountId);
    expect(attached).not.toBeNull();
    expect(attached!.githubUserId).toBe(githubUserId);
  });
});
