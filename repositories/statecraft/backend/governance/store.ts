/**
 * CoreLedger index for governance (spec 008 §2).
 *
 * The append-only chain file (owned by the governance-native addon) is the
 * authority; CoreLedger keeps a queryable index row per attestation so
 * `GET /governance/records?subject=` and per-actor trust reads do not have to
 * scan the chain. CoreLedger runs the Postgres driver in the control plane
 * (spec 001 §3); no Encore SQLDatabase, no direct SQL client.
 */
import { Column, Entity, ledger, Repository } from "../core/ledger";

/** One index row per appended attestation. `recordSeq` mirrors the chain. */
@Entity("governance_attestations")
export class Attestation {
  @Column({ primary: true }) recordSeq = 0;
  @Column() kind = "";
  @Column() subject = "";
  @Column() recordHash = "";
  @Column() payloadHash = "";
  @Column() actor = "";
  @Column({ type: "timestamp" }) createdAt = new Date();
}

/** Per-actor rolling trust snapshot (the addon's envelope JSON, opaque here). */
@Entity("governance_trust")
export class TrustSnapshot {
  @Column({ primary: true }) actor = "";
  @Column({ type: "text" }) snapshot = "";
  @Column({ type: "timestamp" }) updatedAt = new Date();
}

let ready: Promise<void> | undefined;

/** Ensure the ledger is initialised and the governance tables exist. */
export async function initStore(): Promise<void> {
  if (!ready) {
    ready = ledger().init([Attestation, TrustSnapshot]);
  }
  return ready;
}

export function attestations(): Repository<Attestation> {
  return ledger().repo(Attestation);
}

export function trustSnapshots(): Repository<TrustSnapshot> {
  return ledger().repo(TrustSnapshot);
}
