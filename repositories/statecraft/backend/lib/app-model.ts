/**
 * The platform's app-model loader (spec 012 §4): synchronous, at module
 * evaluation, so nothing that renders or gates on the model can precede it.
 * This is the statecraft stand-in for the chassis kernel boot (enrahitu spec
 * 021 backend/kernel/boot.ts): the platform pre-dates the kernel plane, so
 * there is no napi adjudicator here, but the fail-closed posture is kept.
 * The committed model's integrity hash (sha256 over canonical key-sorted
 * bytes, the same algorithm the toolchain extractor seals with) is
 * re-verified at load, and a hand-edited model refuses to boot.
 *
 * The model itself is produced by scripts/extract-model.mjs (spec 012) from
 * the Encore build metadata plus app-manifest.json, never edited by hand.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface ModelReceipt {
  modelHash: string;
  gateConfigHash: string;
  contractVersion: string;
  app: string;
  services: number;
  agents: number;
  capabilities: number;
}

/** Mirrors the toolchain's canonical.mjs: recursive lexicographic key sort. */
function sortValue(value: unknown, path: string): unknown {
  if (Array.isArray(value)) {
    return value.map((v, i) => sortValue(v, `${path}[${i}]`));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortValue((value as Record<string, unknown>)[key], `${path}.${key}`);
    }
    return out;
  }
  if (typeof value === "number" && !Number.isInteger(value)) {
    throw new Error(`non-integer number at ${path}: the model permits integers only`);
  }
  return value;
}

/** The model hash: canonical bytes (compact + trailing newline) minus `integrity`. */
export function computeIntegrityHash(doc: Record<string, unknown>): string {
  const { integrity: _dropped, ...rest } = doc;
  const bytes = Buffer.from(`${JSON.stringify(sortValue(rest, "$"))}\n`, "utf8");
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

const modelPath =
  process.env.ENRAHITU_APP_MODEL_PATH ?? join(process.cwd(), "app-model.json");

/** The committed model's exact bytes; every model render derives from them. */
export const modelJson: string = readFileSync(modelPath, "utf8");

interface ModelDoc {
  contract?: { version?: string };
  app?: { name?: string };
  gate?: { configHash?: string };
  services?: unknown[];
  agents?: unknown[];
  capabilities?: unknown[];
  integrity?: { hash?: string };
}

const doc = JSON.parse(modelJson) as ModelDoc & Record<string, unknown>;

// Fail closed, never a warning: a model whose content does not match its
// sealed hash is refused and the process does not come up.
const computed = computeIntegrityHash(doc);
if (doc.integrity?.hash !== computed) {
  throw new Error(
    `app-model.json integrity refused: sealed ${doc.integrity?.hash ?? "(missing)"}, computed ${computed}; ` +
      "regenerate through `npm run extract:model` (spec 012), never by hand",
  );
}

/** The load receipt (the chassis BootReceipt shape, statecraft-verified). */
export const receipt: ModelReceipt = {
  modelHash: computed,
  gateConfigHash: doc.gate?.configHash ?? "",
  contractVersion: doc.contract?.version ?? "",
  app: doc.app?.name ?? "",
  services: doc.services?.length ?? 0,
  agents: doc.agents?.length ?? 0,
  capabilities: doc.capabilities?.length ?? 0,
};
