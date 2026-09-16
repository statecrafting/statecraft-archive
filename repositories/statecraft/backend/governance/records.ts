/**
 * Attestation records: append, list, verify (spec 008 §2).
 *
 * The full payload goes into the tamper-evident chain (the authority); a
 * CoreLedger row indexes it for queries. A caller records an attestation after
 * a privileged action, attaching the gate's config hash (from POST
 * /governance/gate) and, for factory stamps, the born-with certHash (enrahitu
 * spec 012) so the repo-local cert and the platform ledger are mutually
 * checkable.
 */
import { randomUUID } from "node:crypto";
import { api } from "encore.dev/api";

import { governanceStateDir } from "./config";
import native from "./native";
import { attestations, initStore, Attestation } from "./store";

export type AttestationKind =
  | "stamp"
  | "deploy"
  | "update"
  | "backup"
  | "remove"
  | "approval"
  // Tenant lifecycle (spec 011 §5.5): deleting a tenant is a privileged act.
  | "tenant_delete";

interface RecordRequest {
  kind: AttestationKind;
  /** Primary subject id (e.g. app or tenant id) used for indexing. */
  subject: string;
  /** Additional subject ids carried in the payload. */
  subjectIds?: string[];
  /** The acting user or agent identity. */
  actor: string;
  /** The full action payload; its keysorted sha256 becomes payloadHash. */
  payload: Record<string, unknown>;
  /** The gate config hash from the allow decision that authorised this action. */
  configHash?: string;
  /** Factory stamps: the born-with certificate hash (enrahitu spec 012). */
  certHash?: string;
}

interface RecordResponse {
  seq: number;
  recordHash: string;
  payloadHash: string;
}

// POST /governance/records : append an attestation to the chain + index it.
export const record = api(
  { expose: false, method: "POST", path: "/governance/records" },
  async (req: RecordRequest): Promise<RecordResponse> => {
    await initStore();

    const payloadHash = native.canonicalize(JSON.stringify(req.payload)).sha256;
    const id = randomUUID();
    const timestamp = new Date().toISOString();

    const chainRecord = {
      id,
      timestamp,
      kind: req.kind,
      subject: req.subject,
      subjectIds: req.subjectIds ?? [],
      actor: req.actor,
      payloadHash,
      ...(req.configHash ? { configHash: req.configHash } : {}),
      ...(req.certHash ? { certHash: req.certHash } : {}),
      payload: req.payload,
    };

    const appended = native.ledgerAppend(
      governanceStateDir(),
      JSON.stringify(chainRecord),
    );

    await attestations().insert(
      Object.assign(new Attestation(), {
        recordSeq: appended.seq,
        kind: req.kind,
        subject: req.subject,
        recordHash: appended.recordHash,
        payloadHash,
        actor: req.actor,
        createdAt: new Date(timestamp),
      }),
    );

    return { seq: appended.seq, recordHash: appended.recordHash, payloadHash };
  },
);

interface ListRequest {
  subject: string;
}

/**
 * Wire shape of one indexed attestation. Mirrors the CoreLedger `Attestation`
 * entity's columns, but is declared as a plain interface: Encore's schema
 * parser does not accept a decorated entity class as an API response type
 * ("class types are not yet supported in schemas"). The entity instances are
 * structurally assignable to this shape, so no runtime mapping is needed.
 */
interface AttestationRecord {
  recordSeq: number;
  kind: string;
  subject: string;
  recordHash: string;
  payloadHash: string;
  actor: string;
  createdAt: Date;
}

interface ListResponse {
  records: AttestationRecord[];
}

// GET /governance/records?subject=... : list index rows for a subject.
export const list = api(
  { expose: true, method: "GET", path: "/governance/records" },
  async ({ subject }: ListRequest): Promise<ListResponse> => {
    await initStore();
    const records = await attestations().findWhere({ subject });
    return { records };
  },
);

interface VerifyResponse {
  ok: boolean;
  /** Number of records in the chain (the chain head is record `seq - 1`). */
  seq: number;
  error?: string;
}

// GET /governance/verify : independently verify the whole chain.
export const verify = api(
  { expose: true, method: "GET", path: "/governance/verify" },
  async (): Promise<VerifyResponse> => {
    const result = native.ledgerVerify(governanceStateDir());
    return { ok: result.ok, seq: result.seq, error: result.error };
  },
);
