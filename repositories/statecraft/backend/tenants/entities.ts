/**
 * CoreLedger entities for the tenancy spine (spec 004 §3).
 *
 * A `Tenant` is a customer workspace owned by the user who created it. An
 * `Installation` records one statecraft GitHub App installation into that
 * customer's org; a tenant may hold several installations, and an installation
 * belongs to exactly one tenant. Everything the platform later does for a
 * customer keys off `installationId` (spec 004 summary). CoreLedger runs the
 * Postgres driver in the control plane; no Encore SQLDatabase, no direct SQL.
 */
import { randomUUID } from "node:crypto";

import { Column, Entity } from "../core/ledger";

@Entity("tenant")
export class Tenant {
  @Column({ primary: true }) id = randomUUID();
  @Column() name = "";
  @Column({ index: true }) ownerUserId = "";
  @Column({ type: "timestamp" }) createdAt = new Date();
}

/** Installation lifecycle, driven by the setup callback and webhook events. */
export type InstallationStatus = "active" | "suspended" | "removed";

@Entity("installation")
export class Installation {
  @Column({ primary: true }) id = randomUUID();
  @Column({ index: true }) tenantId = "";
  @Column() githubOrg = "";
  // GitHub's numeric installation id, stored as a string for uniform URL/JSON
  // handling. Unique: one record per installation across all tenants.
  @Column({ unique: true }) installationId = "";
  @Column() status: InstallationStatus = "active";
  @Column({ type: "timestamp" }) createdAt = new Date();
  @Column({ type: "timestamp" }) updatedAt = new Date();
}
