#!/usr/bin/env node
/**
 * The platform's app-model producer (spec 012). Reads .encore/build/meta
 * (run `npm run build:app` first) plus app-manifest.json, lowers, seals,
 * verifies, and emits app-model.json at the repo root. With --check,
 * recomputes and compares against the committed model instead of writing.
 *
 * This deliberately drives the pinned @statecrafting/toolchain's own
 * extractor modules (meta decode, lowering, canonical hashing, the OTel
 * wiring observation) rather than forking them: the platform's model is
 * produced by the same observation code as a chassis app's. What it does
 * NOT run is the toolchain's kernel verify step (`enrahitu-extract`):
 * that gate presumes the post-021 chassis (governed facades under
 * backend/kernel/, the bare-fetch ban), which the platform pre-dates.
 * Until the kernel plane is adopted, the statecraft-native checks below
 * keep the model honest: the manifest's service set must equal the built
 * app's, observability.otel must match the observed wiring, and every
 * Encore secret binding must be declared. The gate hash is sealed from the
 * governance spine's real config (spec 008, governance-native), not the
 * kernel's roster hash.
 *
 * Exit codes (spec-spine discipline): 0 ok; 1 verify violation; 2 stale
 * committed model (including hand-edits); 3 I/O or input error.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const toolchainRoot = dirname(require.resolve("@statecrafting/toolchain/package.json"));
const toolchainLib = (rel) => pathToFileURL(join(toolchainRoot, "lib", "extract", rel)).href;

const { canonicalStringify, computeIntegrityHash, prettyStringify } = await import(
  toolchainLib("canonical.mjs")
);
const { decodeMeta } = await import(toolchainLib("meta.mjs"));
const { lowerModel } = await import(toolchainLib("lower.mjs"));
const { otelObserved } = await import(toolchainLib("usage.mjs"));

const repoRoot = process.cwd();
const checkMode = process.argv.includes("--check");
const modelPath = join(repoRoot, "app-model.json");

function fail(code, message) {
  console.error(`extract-model: ${message}`);
  process.exit(code);
}

function gitSource() {
  try {
    const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot })
      .toString()
      .trim();
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot })
      .toString()
      .trim();
    return { revision, uncommittedChanges: status.length > 0 };
  } catch (err) {
    fail(3, `cannot determine git identity: ${err.message}`);
  }
}

/**
 * The governance gate's real config hash (spec 008): the same
 * governance-native code that gates privileged actions computes it, so the
 * model records the hash the running gate will report.
 */
function gateConfigHash() {
  const native = require("@statecrafting/governance-native");
  const configJson = readFileSync(
    join(repoRoot, "backend", "governance", "config", "gate.v1.json"),
    "utf8",
  );
  const benign = JSON.stringify({
    action: "model-extract",
    payload_summary: "",
    payload_body: null,
    attributes: {},
  });
  return native.gateEvaluate(configJson, benign).configHash;
}

/** Statecraft-native honesty checks (the pre-kernel subset of verify). */
function verifyStatecraft({ model, manifest, meta }) {
  const violations = [];

  const metaNames = new Set(meta.svcs.map((s) => s.name));
  const manifestNames = new Set(Object.keys(manifest.services ?? {}));
  for (const name of metaNames) {
    if (!manifestNames.has(name))
      violations.push(`service '${name}' exists in source but not in app-manifest.json`);
  }
  for (const name of manifestNames) {
    if (!metaNames.has(name))
      violations.push(`service '${name}' declared in app-manifest.json but not found in source`);
  }

  const declaredOtel = manifest.observability?.otel ?? false;
  const observedOtel = model.observability?.otel ?? false;
  if (declaredOtel !== observedOtel) {
    violations.push(
      `app-manifest.json declares observability.otel: ${declaredOtel} but the import walk ` +
        `observes ${observedOtel}; align the manifest with the wiring`,
    );
  }

  const declaredSecrets = new Set((model.resources.secrets ?? []).map((s) => s.name));
  for (const pkg of meta.pkgs ?? []) {
    for (const name of pkg.secrets ?? []) {
      if (!declaredSecrets.has(name.toLowerCase())) {
        violations.push(
          `secret '${name}' observed in ${pkg.relPath} but not declared in resources.secrets`,
        );
      }
    }
  }

  if (violations.length > 0) {
    fail(1, `app-model verification failed:\n  - ${violations.join("\n  - ")}`);
  }
}

async function recompute() {
  const metaPath = join(repoRoot, ".encore", "build", "meta");
  if (!existsSync(metaPath)) {
    fail(3, `${metaPath} not found: run the app build (npm run build:app) first`);
  }
  const manifestPath = join(repoRoot, "app-manifest.json");
  if (!existsSync(manifestPath)) {
    fail(3, `${manifestPath} not found: the app manifest is required (spec 012)`);
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    fail(3, `app-manifest.json does not parse: ${err.message}`);
  }
  const meta = await decodeMeta(metaPath);
  const toolchainVersion = require("@statecrafting/toolchain/package.json").version;

  const model = lowerModel({
    meta,
    manifest,
    source: gitSource(),
    producerVersion: toolchainVersion,
    otelObserved: otelObserved(
      repoRoot,
      meta.svcs.map((svc) => svc.relPath),
    ),
  });

  // The producer is this script driving the pinned toolchain's modules;
  // name it truthfully (the version is the toolchain's).
  model.extraction.producers = [
    { tool: "statecraft-extract-model", version: toolchainVersion, tier: "ts" },
  ];

  // Seal: the governance gate's real config hash, then the integrity hash.
  model.gate.configHash = gateConfigHash();
  model.integrity.hash = computeIntegrityHash(model);

  verifyStatecraft({ model, manifest, meta });
  return model;
}

/** Semantic comparison form: everything except source and integrity. */
function comparable(model) {
  const { source: _s, integrity: _i, ...rest } = model;
  return canonicalStringify(rest);
}

const model = await recompute();

if (!checkMode) {
  writeFileSync(modelPath, prettyStringify(model));
  console.log(
    `extract-model: wrote app-model.json (${model.integrity.hash}, gate ${model.gate.configHash})`,
  );
  process.exit(0);
}

if (!existsSync(modelPath)) {
  fail(2, "no committed app-model.json: run `npm run extract:model` and commit the result");
}
let committed;
try {
  committed = JSON.parse(readFileSync(modelPath, "utf8"));
} catch (err) {
  fail(2, `committed app-model.json does not parse: ${err.message}`);
}
if (computeIntegrityHash(committed) !== committed.integrity?.hash) {
  fail(
    2,
    "committed app-model.json is not self-consistent (hand-edited?): its integrity.hash does not match its content",
  );
}
if (comparable(committed) !== comparable(model)) {
  fail(
    2,
    "committed app-model.json is stale: recomputation differs; run `npm run extract:model` and commit the result",
  );
}
console.log(`extract-model: committed model is fresh (${committed.integrity.hash})`);
