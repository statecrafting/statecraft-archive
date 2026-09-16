/**
 * Fleet CoreLedger entities (spec 006 §2).
 *
 * `FleetApp` is one placed app (its Kubernetes namespace, image, host, and
 * lifecycle status). `FleetOp` is the intent journal: every mutating verb
 * (deploy / update / backup / remove) writes a row before calling the addon and
 * updates it on completion, so a reader always sees what the fleet did and
 * whether it finished. CoreLedger runs the Postgres driver in the control plane;
 * no Encore SQLDatabase, no direct SQL.
 */
import { randomUUID } from "node:crypto";

import { Column, Entity } from "../core/ledger";

import type { FleetOpKind, FleetOpStatus } from "./ops";

/** The lifecycle of a placed app (spec 006 §2). `removed` is terminal. */
export type FleetAppStatus = "placing" | "running" | "updating" | "failed" | "removed";

@Entity("fleet_app")
export class FleetApp {
  @Column({ primary: true }) id = randomUUID();
  @Column({ index: true }) tenantId = "";
  /** The stamp job that produced this app's image, when it came from the factory. */
  @Column({ nullable: true }) stampJobId: string | null = null;
  /**
   * DNS-1123 label: the resource name and the `<name>.<FLEET_BASE_DOMAIN>` host
   * label. Indexed, deliberately not database-unique: `removed` is terminal but
   * the row stays for the audit trail, so a UNIQUE column would retire a name
   * forever the first time an app was placed under it. Uniqueness is scoped to
   * live apps and enforced in `store.ts` (`findLiveAppByName`), which lets
   * deploy answer a typed conflict instead of a driver error.
   */
  @Column({ index: true }) name = "";
  /** The tenant namespace `t-<tenantId>` the app is placed in. */
  @Column() namespace = "";
  /** The exact registry ref currently placed (spec 006 §3 image source). */
  @Column() image = "";
  /** PVC size in GiB (default 1). */
  @Column({ type: "integer" }) volumeSize = 1;
  /**
   * Container port the app serves; the addon keys PORT env, probes, Service,
   * and Ingress off it. Persisted so update rebuilds the Deployment with the
   * same port the deploy chose (enrahitu chassis images are fixed on 8080;
   * the addon default is 4000).
   */
  @Column({ type: "integer" }) port = 4000;
  @Column() host = "";
  @Column({ index: true }) status: FleetAppStatus = "placing";
  @Column({ type: "timestamp" }) createdAt = new Date();
  @Column({ type: "timestamp" }) updatedAt = new Date();
}

@Entity("fleet_op")
export class FleetOp {
  @Column({ primary: true }) id = randomUUID();
  @Column({ index: true }) appId = "";
  @Column() kind: FleetOpKind = "deploy";
  @Column({ index: true }) status: FleetOpStatus = "running";
  /** Free-text outcome detail (error message, or the backup artifact location). */
  @Column({ nullable: true }) log: string | null = null;
  @Column({ type: "timestamp" }) createdAt = new Date();
}
