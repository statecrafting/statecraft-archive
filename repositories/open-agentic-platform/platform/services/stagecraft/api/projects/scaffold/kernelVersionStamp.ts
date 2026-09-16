// Spec 167 §2.3 — born-with spec-spine kernel stamp (npm distribution shape).
//
// Statecraft's Create flow writes `.kernel-version` into commit #1 of every
// produced project (sibling to the `.factory/pipeline-state.json` L0 seed).
// It records WHICH spec-spine toolchain a project was born under, so kernel
// propagation/audit (spec 209) can reason about update eligibility.
//
// Distribution-shape correction (spec 167 self-amend, 2026-06-11): the kernel
// is the *published `spec-spine` npm devDependency* carried by the prebuilt
// template — NOT vendored loose binaries. So the load-bearing pin is the
// exact-pinned `spec-spine` version resolved from the scaffolded package.json,
// and `toolchain_mode` is `pinned-toolchain` (the kebab-case value the Rust
// `KernelVersion`/`ToolchainMode` enum already understands — spec 168 E2
// consistency rule; we never write the unknown `npm-devdependency` variant).
//
// The Rust `KernelVersion` struct (crates/factory-engine/src/kernel_emission/
// version.rs) gains a `spec_spine_version` field under `#[serde(default)]` in
// a follow-up so `from_yaml` can read this stamp; serde ignores the extra
// field until then.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type { ScaffoldAdapterRef } from "./types";

export interface KernelVersionStamp {
  schema_version: "1.0.0";
  /** The kebab-case serde value of the Rust ToolchainMode enum (spec 168 E2). */
  toolchain_mode: "pinned-toolchain";
  kernel: {
    /** The adapter/OAP source SHA the kernel was born from. */
    source_commit: string;
    /** The exact-pinned `spec-spine` npm version (the canonical born-with pin). */
    spec_spine_version: string;
    /** ISO-8601; legitimately varies per scaffold (spec 167 FR-009). */
    emitted_at: string;
  };
  adapter: {
    /** The adapter SLUG (e.g. "acme-vue-encore"), NOT the factory_adapters DB
     *  FK. Matches the Rust `AdapterIdentity.id` semantics, which is also the
     *  manifest's `adapter.name` (engine.rs sets `id: manifest.adapter.name`). */
    id: string;
    version: string;
    /** SHA-256 over the canonical (sorted-key) manifest JSON. */
    manifest_hash: string;
  };
}

/** Deterministic JSON: object keys sorted recursively, so the manifest hash is
 *  stable across runs regardless of parse order. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const body = Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",");
  return `{${body}}`;
}

export function manifestHash(manifest: Record<string, unknown>): string {
  return createHash("sha256").update(stableStringify(manifest)).digest("hex");
}

async function readSpecSpinePinFrom(pkgPath: string): Promise<string | null> {
  let text: string;
  try {
    text = await readFile(pkgPath, "utf8");
  } catch (err) {
    // A genuinely-absent candidate (ENOENT) is the expected "try the next
    // location" path; any other I/O error (EACCES, EMFILE, …) is real and
    // must surface, not be silently swallowed as "no package.json here".
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
  let pkg: { devDependencies?: Record<string, string>; dependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`scaffolded package.json at ${pkgPath} is not valid JSON: ${msg}`);
  }
  return pkg.devDependencies?.["spec-spine"] ?? pkg.dependencies?.["spec-spine"] ?? null;
}

/** Read the exact-pinned `spec-spine` devDependency from the scaffolded tree.
 *  Single-profile scaffolds carry the spine at the root; the `dual` profile
 *  copies the complete template base into each variant subdir (public/,
 *  internal/), so the root has no package.json — read the pin from the first
 *  variant. Throws if absent everywhere — the npm born-with kernel requires the
 *  pin, and a missing pin is a hard error, never a silent skip (spec 167). */
export async function resolveSpecSpinePin(destDir: string): Promise<string> {
  const candidates = [destDir, join(destDir, "public"), join(destDir, "internal")];
  for (const dir of candidates) {
    const pin = await readSpecSpinePinFrom(join(dir, "package.json"));
    if (pin) {
      return pin;
    }
  }
  throw new Error(
    `no spec-spine dependency found in package.json under ${destDir} ` +
      `(checked root + public/ + internal/) — the born-with kernel is the ` +
      `published spec-spine npm pin (spec 167 §2.1/§2.2)`
  );
}

export function buildKernelVersionStamp(opts: {
  adapter: ScaffoldAdapterRef;
  manifest: Record<string, unknown>;
  specSpineVersion: string;
  now?: string;
}): KernelVersionStamp {
  return {
    schema_version: "1.0.0",
    toolchain_mode: "pinned-toolchain",
    kernel: {
      source_commit: opts.adapter.sourceSha,
      spec_spine_version: opts.specSpineVersion,
      emitted_at: opts.now ?? new Date().toISOString(),
    },
    adapter: {
      // .name is the adapter slug — the Rust AdapterIdentity.id value (see the
      // KernelVersionStamp interface), not ScaffoldAdapterRef.id (the DB FK).
      id: opts.adapter.name,
      version: opts.adapter.version,
      manifest_hash: manifestHash(opts.manifest),
    },
  };
}

/** YAML form written to `.kernel-version` (Rust `KernelVersion::from_yaml`
 *  reads YAML). */
export function serializeKernelVersionStamp(stamp: KernelVersionStamp): string {
  return stringifyYaml(stamp);
}
