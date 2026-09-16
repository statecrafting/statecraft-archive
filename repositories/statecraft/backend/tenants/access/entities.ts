/**
 * Tenant membership: the second authorization tier (spec 011 §3, §5.2).
 *
 * Tier one is the global `statecraft_operator` rauthy role (checked via
 * lib/roles, never stored here). Tier two is this per-tenant, org-derived
 * membership: a row records that a GitHub identity may act on one tenant as
 * `admin` or `member`. Membership is never a rauthy role and never global, so
 * a customer who installs the App can never escalate to platform power.
 *
 * A row is keyed by a GitHub identity that may be known by its numeric id
 * (`githubUserId`, from an org sweep or a direct-install webhook) and/or by the
 * app user it has resolved to (`userAccountId`, attached at login). Both are
 * nullable because the two entry paths learn the two sides at different times:
 * a tenant-less install grants by `userAccountId` before the GitHub id is
 * resolved; a direct-from-GitHub install grants by `githubUserId` before the
 * user has ever signed in. Login-time reconciliation (spec 011 §5.3) fills in
 * the missing side. Authorization reads the `userAccountId` side.
 */
import { randomUUID } from "node:crypto";

import { Column, Entity } from "../../core/ledger";

/** Tenant-scoped role: admin may mutate, member may read (spec 011 §3). */
export type MembershipRole = "admin" | "member";

/**
 * How the row came to exist. `operator` grants are authoritative: login-time
 * reconciliation never downgrades or removes them (spec 011 §5.2).
 */
export type MembershipSource = "install" | "reconcile" | "operator";

@Entity("tenant_membership")
export class TenantMembership {
  @Column({ primary: true }) id = randomUUID();
  @Column({ index: true }) tenantId = "";
  /** GitHub numeric id as a string; null until an org sweep or webhook learns it. */
  @Column({ nullable: true, index: true }) githubUserId: string | null = null;
  /** The app user this GitHub identity resolved to; null until first login. */
  @Column({ nullable: true, index: true }) userAccountId: string | null = null;
  @Column() role: MembershipRole = "member";
  @Column() source: MembershipSource = "reconcile";
  @Column({ type: "timestamp" }) createdAt = new Date();
  @Column({ type: "timestamp" }) updatedAt = new Date();
  @Column({ type: "timestamp", nullable: true }) lastReconciledAt: Date | null = null;
}
