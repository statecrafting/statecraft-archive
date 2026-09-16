/**
 * The tenant authorization rule (spec 011 §3). Pure decision helpers are tested
 * directly; the end-to-end `authorizeTenant` runs against the process-wide test
 * ledger (vitest.setup points it at a throwaway file), using random ids so each
 * case is independent.
 */
import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createTenantForOrg } from "../store";

import { OPERATOR_ROLE, authorizeTenant, isOperator, roleSatisfies } from "./authz";
import { upsertMembership } from "./store";

describe("roleSatisfies", () => {
  it("admits any member for read", () => {
    expect(roleSatisfies("read", "member")).toBe(true);
    expect(roleSatisfies("read", "admin")).toBe(true);
  });

  it("requires admin for write", () => {
    expect(roleSatisfies("write", "member")).toBe(false);
    expect(roleSatisfies("write", "admin")).toBe(true);
  });
});

describe("isOperator", () => {
  it("detects the statecraft_operator role only", () => {
    expect(isOperator({ userID: "u", roles: [OPERATOR_ROLE] })).toBe(true);
    expect(isOperator({ userID: "u", roles: ["user", "rauthy_admin"] })).toBe(false);
    expect(isOperator({ userID: "u", roles: [] })).toBe(false);
  });
});

describe("authorizeTenant", () => {
  it("admits a platform operator on a tenant they do not own", async () => {
    const tenant = await createTenantForOrg("Acme", randomUUID());
    const operator = { userID: randomUUID(), roles: [OPERATOR_ROLE] };
    expect(await authorizeTenant(tenant.id, operator, "write")).not.toBeNull();
  });

  it("admits the legacy owner", async () => {
    const owner = randomUUID();
    const tenant = await createTenantForOrg("Acme", owner);
    expect(await authorizeTenant(tenant.id, { userID: owner, roles: ["user"] }, "write")).not.toBeNull();
  });

  it("admits a member for read but denies write", async () => {
    const tenant = await createTenantForOrg("Acme", randomUUID());
    const member = randomUUID();
    await upsertMembership({
      tenantId: tenant.id,
      userAccountId: member,
      role: "member",
      source: "reconcile",
    });
    const principal = { userID: member, roles: ["user"] };
    expect(await authorizeTenant(tenant.id, principal, "read")).not.toBeNull();
    expect(await authorizeTenant(tenant.id, principal, "write")).toBeNull();
  });

  it("admits an admin member for write", async () => {
    const tenant = await createTenantForOrg("Acme", randomUUID());
    const admin = randomUUID();
    await upsertMembership({
      tenantId: tenant.id,
      userAccountId: admin,
      role: "admin",
      source: "install",
    });
    expect(await authorizeTenant(tenant.id, { userID: admin, roles: ["user"] }, "write")).not.toBeNull();
  });

  it("denies a stranger and a missing tenant, even for an operator", async () => {
    const tenant = await createTenantForOrg("Acme", randomUUID());
    expect(
      await authorizeTenant(tenant.id, { userID: randomUUID(), roles: ["user"] }, "read"),
    ).toBeNull();
    expect(
      await authorizeTenant(randomUUID(), { userID: randomUUID(), roles: [OPERATOR_ROLE] }, "read"),
    ).toBeNull();
  });
});
