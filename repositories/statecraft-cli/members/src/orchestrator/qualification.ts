// Spec 124: qualification (doc 04 D57). A conformance pass over faked
// binaries says a driver honors the contract; a qualification record says a
// real binary did, once, on a machine of record: its version, the platform,
// the capabilities it declared and what it applied and degraded on a live
// turn, the denials it reported, and how the turn ended. The records live
// under docs/evidence/qualification/ as committed evidence. A driver whose
// binary version has no record runs as unqualified: shown in the posture,
// journaled once per driver per daemon life, never refused (B-6).

import * as fs from "fs";
import { join } from "path";
import type { JsonValue } from "./journal";

export const QUALIFICATION_SCHEMA_VERSION = 1;
export const QUALIFICATION_DIR_ENV = "STATECRAFT_QUALIFICATION_DIR";
export const UNQUALIFIED_KIND = "driver.unqualified";

export interface QualificationRecord {
  readonly schemaVersion: typeof QUALIFICATION_SCHEMA_VERSION;
  readonly driver: string;
  readonly binary: { readonly path: string; readonly version: string };
  readonly platform: { readonly os: string; readonly arch: string };
  readonly capabilities: { readonly declared: readonly string[]; readonly applied: readonly string[]; readonly degraded: readonly string[] };
  readonly denials: number;
  readonly classification: string;
  readonly recordedAt: string;
}

// Where the records live: the environment's say, else this repository's
// evidence directory (resolved from the source tree; a compiled bundle has
// no source tree and reads the environment or the working directory).
export function qualificationDir(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env[QUALIFICATION_DIR_ENV];
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  const fromSource = join(import.meta.dir, "..", "..", "..", "docs", "evidence", "qualification");
  if (fs.existsSync(fromSource)) return fromSource;
  return join(process.cwd(), "docs", "evidence", "qualification");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringList(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((s) => typeof s === "string") ? [...(v as string[])] : null;
}

// A malformed record is null, never a record with guessed fields.
export function parseQualificationRecord(value: unknown): QualificationRecord | null {
  if (!isRecord(value) || value.schemaVersion !== QUALIFICATION_SCHEMA_VERSION) return null;
  const { binary, platform, capabilities } = value;
  if (typeof value.driver !== "string" || !isRecord(binary) || !isRecord(platform) || !isRecord(capabilities)) return null;
  if (typeof binary.path !== "string" || typeof binary.version !== "string") return null;
  if (typeof platform.os !== "string" || typeof platform.arch !== "string") return null;
  const declared = stringList(capabilities.declared);
  const applied = stringList(capabilities.applied);
  const degraded = stringList(capabilities.degraded);
  if (declared === null || applied === null || degraded === null) return null;
  if (typeof value.denials !== "number" || typeof value.classification !== "string" || typeof value.recordedAt !== "string") return null;
  return {
    schemaVersion: QUALIFICATION_SCHEMA_VERSION,
    driver: value.driver,
    binary: { path: binary.path, version: binary.version },
    platform: { os: platform.os, arch: platform.arch },
    capabilities: { declared, applied, degraded },
    denials: value.denials,
    classification: value.classification,
    recordedAt: value.recordedAt,
  };
}

export function qualificationPayload(record: QualificationRecord): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(record)) as Record<string, JsonValue>;
}

// Every record in the directory, by driver name; one file per driver.
export function readQualifications(dir: string = qualificationDir()): ReadonlyMap<string, QualificationRecord> {
  const out = new Map<string, QualificationRecord>();
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names.sort()) {
    if (!name.endsWith(".json")) continue;
    try {
      const record = parseQualificationRecord(JSON.parse(fs.readFileSync(join(dir, name), "utf8")));
      if (record !== null) out.set(record.driver, record);
    } catch {
      // An unreadable record is no record.
    }
  }
  return out;
}

export interface QualificationVerdict {
  readonly qualified: boolean;
  readonly record: QualificationRecord | null;
}

// B-6: qualified when a record exists for the driver and names this binary
// version. An unknown binary version (the driver could not read one) never
// matches: evidence is about a version, and none was seen.
export function qualificationFor(driver: string, binaryVersion: string | null, dir: string = qualificationDir()): QualificationVerdict {
  const record = readQualifications(dir).get(driver) ?? null;
  return { qualified: record !== null && binaryVersion !== null && record.binary.version === binaryVersion, record };
}

// The posture cell's suffix (B-6).
export function renderQualification(verdict: QualificationVerdict | null): string {
  return verdict === null || verdict.qualified ? "" : " (unqualified)";
}
