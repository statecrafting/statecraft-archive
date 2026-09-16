/**
 * Factory CoreLedger entity (spec 005 §3).
 *
 * One `StampJob` row per stamp request; the async pipeline records progress by
 * transitioning `status` and filling `certHash` / `checksRunId` / `error`. The
 * pipeline re-reads the job, so everything it needs (including `posture`, which
 * feeds the born-with cert) is persisted here. CoreLedger runs the Postgres
 * driver in the control plane; no Encore SQLDatabase, no direct SQL.
 */
import { randomUUID } from "node:crypto";

import { Column, Entity } from "../core/ledger";

import type { StampStatus } from "./jobs";

export type Posture = "none" | "assisted" | "autonomous";

/**
 * How the stamp lands (spec 005 §3): `create` births a fresh repo in the
 * customer org (the stamped tree is the initial commit); `adopt` stamps the
 * chassis onto an EXISTING repo via a pull request, so a repo that already
 * carries its own content keeps it and a human reviews the overlay before merge.
 */
export type StampMode = "create" | "adopt";

@Entity("stamp_job")
export class StampJob {
  @Column({ primary: true }) id = randomUUID();
  @Column({ index: true }) tenantId = "";
  @Column() installationId = "";
  @Column({ index: true }) appName = "";
  @Column() org = "";
  // The selected frontend flavor slot (enrahitu spec 015): passed to the
  // scaffold verb's --frontend. Empty means the template's contract default.
  @Column() frontend = "";
  @Column() mode: StampMode = "create";
  // Opt-in Pages provisioning (create mode): after push, enable GitHub Pages
  // (source = Actions) and set ENABLE_PAGES=true so the born-with pages.yml
  // auto-publishes the SPA preview (enrahitu spec 013). Off by default; needs
  // the App's Pages: write + Variables: write grant (spec 004 §1).
  @Column({ type: "boolean" }) pages = false;
  @Column() templateRef = "";
  @Column() contractVersion = "";
  @Column() posture: Posture = "none";
  @Column({ index: true }) status: StampStatus = "queued";
  @Column({ nullable: true }) checksRunId: string | null = null;
  @Column({ nullable: true }) certHash: string | null = null;
  // adopt mode only: the URL of the pull request the stamp opened.
  @Column({ nullable: true }) prUrl: string | null = null;
  @Column({ nullable: true }) error: string | null = null;
  @Column({ type: "timestamp" }) createdAt = new Date();
  @Column({ type: "timestamp" }) updatedAt = new Date();
}
