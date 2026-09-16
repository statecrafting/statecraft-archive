/**
 * The born-with certificate (spec 005 §3 step 3; enrahitu spec 012).
 *
 * The factory builds the cert; the template's own `verify-born-with.mjs`
 * (invoked by the scaffold verb via `--cert`) validates it against the schema
 * and recomputes its hash. So the canonicalization here MUST be byte-identical
 * to that verifier: recursive lexicographic key sort, then compact
 * `JSON.stringify`, then sha256 hex of the UTF-8 bytes. This is a direct
 * TypeScript port of scripts/verify-born-with.mjs (kept in sync by the golden
 * fixture test), not an import, because that .mjs is a CLI consumed as a child
 * process, not a typed module.
 *
 * Posture is REQUEST-EXPLICIT: the caller must pass it, and `defaulted` is
 * always false. A cert never silently assumes a posture.
 */
import { createHash } from "node:crypto";

import type { Posture } from "./entities";

export const POSTURES: readonly Posture[] = ["none", "assisted", "autonomous"];

export interface BornWithCert {
  certVersion: "1";
  app: { name: string; org: string };
  template: { name: string; version: string; contractVersion: string; commit: string };
  agenticPostureBinding: { posture: Posture; defaulted: false };
  stampedAt: string;
  stampedBy: { kind: "factory"; id: string };
}

export interface BuildCertInput {
  appName: string;
  org: string;
  templateName: string;
  templateVersion: string;
  contractVersion: string;
  commit: string;
  posture: Posture;
  stampedById: string;
  stampedAt?: Date;
}

export class CertError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CertError";
  }
}

export function isPosture(value: string): value is Posture {
  return (POSTURES as readonly string[]).includes(value);
}

export function buildCert(input: BuildCertInput): BornWithCert {
  if (!isPosture(input.posture)) {
    throw new CertError(`posture must be one of ${POSTURES.join(", ")}`);
  }
  if (!/^[0-9a-f]{40}$/.test(input.commit)) {
    throw new CertError("template commit must be a 40-char hex sha");
  }
  return {
    certVersion: "1",
    app: { name: input.appName, org: input.org },
    template: {
      name: input.templateName,
      version: input.templateVersion,
      contractVersion: input.contractVersion,
      commit: input.commit,
    },
    agenticPostureBinding: { posture: input.posture, defaulted: false },
    stampedAt: (input.stampedAt ?? new Date()).toISOString(),
    stampedBy: { kind: "factory", id: input.stampedById },
  };
}

/** Recursive lexicographic key sort; arrays keep order (spec 012 §4). */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalString(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function certHash(cert: unknown): string {
  return createHash("sha256").update(canonicalString(cert), "utf8").digest("hex");
}
