// Spec 112 §5.3 op 3 — per-request scaffold execution.
//
// Mirrors template-distributor/src/server.ts:613-760 minus the in-memory
// poll loop (we drive scaffold_jobs.step from the orchestrator instead).
//
// Per-request flow:
//   1. Copy `${WORKSPACE_DIR}/_prebuilt-<profile>` → destDir (excluding
//      node_modules — they re-resolve from the project's lockfile).
//   2. For each `extras` module (sorted by INSTALL_ORDER), run
//      `tsx _template-cache/scripts/add-module.ts <mod> --yes` with
//      `ROOT=destDir, NO_INSTALL=true`.
//   3. If any extras were applied, run `npm install --package-lock-only`
//      once to produce a coherent lockfile.
//   4. Write `.factory/pipeline-state.json` from the L0 seed so commit #1
//      carries it atomically.

import { spawn } from "node:child_process";
import { cp as cpAsync, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import log from "encore.dev/log";
import { parse as parseYaml } from "yaml";
import {
  buildKernelVersionStamp,
  resolveSpecSpinePin,
  serializeKernelVersionStamp,
} from "./kernelVersionStamp";
import { extrasFor, type ModuleDescriptor, type Profile } from "./moduleCatalog";
import { patchEnvExample } from "./envExample";
import { prebuiltDir, resolveCurrentPrebuiltSha } from "./templateCache";
import type { ScaffoldAdapterRef } from "./types";
import { OAP_BUILD_WORKFLOW_YAML } from "../../github/repoInit";

/**
 * Subprocess env shared with templateCache. Mirrors `tooledEnv` —
 * routes npm + node tooling at writable workspace paths so the pod's
 * `readOnlyRootFilesystem: true` posture doesn't kill `npm install`.
 */
function tooledEnv(
  workspace: string,
  extra: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: join(workspace, ".home"),
    npm_config_cache: join(workspace, ".npm-cache"),
    XDG_CACHE_HOME: join(workspace, ".xdg-cache"),
    ...extra,
  };
}

export interface PerRequestScaffoldOptions {
  workspaceDir: string;
  profile: Profile;
  /** Modules selected by the user (raw; extrasFor filters them down). */
  selectedModules: string[];
  /** Spec 227 Stage 1: derived module catalog, for extrasFor install order. */
  catalog: ModuleDescriptor[];
  /**
   * Spec 227 Stage 2: the profile's manifest-declared built-in modules (from
   * profileModulesFor); extrasFor filters these out of the extras so a profile
   * default is never re-composed.
   */
  profileBuiltIns?: string[];
  /**
   * Spec 227 Stage 2: Base-app config values patched into the produced app's
   * committed `apps/api/.env.example` after module composition.
   */
  baseAppConfig?: {
    privateApiBaseUrl?: string;
    gatewayTimeoutMs?: number;
    /** Spec 229 auth-driver axis: patched as AUTH_DRIVER (mock|rauthy). */
    authDriver?: string;
  };
  destDir: string;
  /** L0 pipeline-state seed object to drop at `.factory/pipeline-state.json`. */
  pipelineStateSeed: Record<string, unknown>;
  /** Adapter identity for the `.kernel-version` born-with stamp (spec 167). */
  adapter: ScaffoldAdapterRef;
  /** Adapter manifest — hashed into the `.kernel-version` stamp (spec 167). */
  manifest: Record<string, unknown>;
  /** Optional progress sink, fed scaffold_jobs.step transitions. */
  log?: (line: string) => void;
}

export interface PerRequestScaffoldResult {
  destDir: string;
  profile: Profile;
  extras: string[];
}

export async function scaffoldFromPrebuilt(
  opts: PerRequestScaffoldOptions
): Promise<PerRequestScaffoldResult> {
  // Resolve the current immutable prebuild snapshot ONCE for the whole request
  // (spec 112 §5.3.1): a concurrent warmup refresh publishes a new snapshot +
  // pointer without disturbing the one we read here.
  const combined = await resolveCurrentPrebuiltSha(opts.workspaceDir);
  if (!combined) {
    throw new Error(
      "scaffoldFromPrebuilt: no published prebuild snapshot (warmup not ready)"
    );
  }
  const sourceDir = prebuiltDir(opts.workspaceDir, combined, opts.profile);
  // add-module + tsx live in the factory cache (the generator home), not the
  // template baseline (spec 112 §5.3.1).
  const factoryScriptsDir = join(
    opts.workspaceDir,
    "_factory-cache",
    "adapters",
    "acme-vue-encore",
    "scripts"
  );
  const factoryModules = join(
    opts.workspaceDir,
    "_factory-cache",
    "node_modules"
  );
  const dest = opts.destDir;
  const sink = opts.log ?? (() => {});

  await mkdir(dest, { recursive: true });

  // ── 1. Copy prebuilt tree, excluding node_modules and VCS state ──────
  // Scaffold-output invariant (spec 112 §5.3): the tree handed to
  // gitInitAndPush is VCS-free — repo initialization belongs to commit #1.
  // Template generators run `git init` in their output for developer use
  // (template's dual profile does so PER VARIANT), and an embedded
  // commit-less repo makes `git add -A` fail with "does not have a commit
  // checked out". Strip `.git` at any depth, regardless of generator.
  // Rejecting a directory by basename is sufficient at any depth: fs.cp
  // skips the entire subtree of a filtered-out directory, so a contents
  // pattern would be dead code (and would leave an empty directory shell
  // at dest, as the old `${sep}node_modules${sep}` match did).
  sink(`copy: ${sourceDir} → ${dest}`);
  await cpAsync(sourceDir, dest, {
    recursive: true,
    filter: (src: string) => {
      const name = basename(src);
      return name !== ".git" && name !== "node_modules";
    },
  });

  // ── 2. Run add-module.ts for each user-selected extra ────────────────
  // The prebuild already ships the profile's manifest-declared default modules
  // (the generator composed them, spec 112 §5.3.1), recorded in the copied
  // template.json. Filter those out so a profile default is never re-composed
  // (which would duplicate its migration); this mirrors the generator's own
  // dedupe and statecraft's extrasFor filtering of profile built-ins.
  const alreadyShipped = await readInstalledModules(dest);
  const extras =
    opts.profile === "dual"
      ? []
      : extrasFor(
          opts.catalog,
          opts.profileBuiltIns ?? [],
          opts.selectedModules
        ).filter((m) => !alreadyShipped.has(m));
  if (extras.length > 0) {
    const tsx = join(factoryModules, "tsx", "dist", "cli.mjs");
    const addModuleScript = join(factoryScriptsDir, "add-module.ts");
    const addModuleEnv = tooledEnv(opts.workspaceDir, {
      NODE_PATH: factoryModules,
      NO_INSTALL: "true",
      // add-module.ts reads ROOT to know where to write; it must be the
      // per-request dest, not the cache dir.
      ROOT: dest,
    });
    for (const mod of extras) {
      sink(`add-module: ${mod}`);
      await spawnAndCapture(
        process.execPath,
        [tsx, addModuleScript, mod, "--yes", "--root", dest],
        factoryScriptsDir,
        addModuleEnv
      );
    }
    // ── 3. Refresh the lockfile once for all extras ─────────────────────
    sink("npm install --package-lock-only");
    await spawnAndCapture(
      "npm",
      ["install", "--package-lock-only"],
      dest,
      tooledEnv(opts.workspaceDir)
    );
  }

  // ── 3b. Patch Base-app config into apps/api/.env.example (spec 227 Stage 2).
  // The gateway knobs (PRIVATE_API_BASE_URL / GATEWAY_TIMEOUT_MS) are born-with
  // baseline env; the create form's values ride commit #1 via the committed
  // `.env.example`. Independent of module selection (the gateway backend ships
  // in every app).
  await applyBaseAppConfig(dest, opts.baseAppConfig, sink);

  // ── 4. Drop the L0 pipeline-state seed ───────────────────────────────
  const factoryDir = join(dest, ".factory");
  await mkdir(factoryDir, { recursive: true });
  await writeFile(
    join(factoryDir, "pipeline-state.json"),
    JSON.stringify(opts.pipelineStateSeed, null, 2) + "\n",
    "utf8"
  );
  sink("seed: .factory/pipeline-state.json");

  // ── 5. Stamp `.kernel-version` (spec 167 §2.3). The born-with kernel ships
  // inside the prebuilt template (the spec-spine npm devDependency + corpus);
  // this is the one additive write the Create flow makes — recording the
  // resolved pin + adapter identity so propagation/audit (spec 209) can see
  // which toolchain the project was born under. The pin is read from the
  // package.json we just copied; a missing pin is a hard error (never silent).
  const specSpineVersion = await resolveSpecSpinePin(dest);
  const kernelStamp = buildKernelVersionStamp({
    adapter: opts.adapter,
    manifest: opts.manifest,
    specSpineVersion,
  });
  await writeFile(
    join(dest, ".kernel-version"),
    serializeKernelVersionStamp(kernelStamp),
    "utf8"
  );
  sink(`stamp: .kernel-version (spec-spine ${specSpineVersion})`);

  // Spec 209 FR-002: fail-closed born-with-kernel completeness check. A
  // project cannot complete creation with a missing or partial kernel.
  await assertBornWithKernelComplete(dest);
  sink("verify: .kernel-version complete (spec 209 FR-002)");

  // ── 6. Seed the active container-build workflow (spec 213 FR-001). Written
  // into the scaffold tree so it rides commit #1 and the scaffolded commit
  // builds with no manual step in the new repo (SC-001). For the dual profile
  // the tree root carries no `.github` (each variant has its own), so create
  // it; the workflow detects the public/internal layout at runtime and builds
  // the matrix from the root (FR-004).
  const workflowsDir = join(dest, ".github", "workflows");
  await mkdir(workflowsDir, { recursive: true });
  await writeFile(
    join(workflowsDir, "oap-build.yml"),
    OAP_BUILD_WORKFLOW_YAML,
    "utf8"
  );
  sink("seed: .github/workflows/oap-build.yml");

  log.info("per-request scaffold: complete", {
    profile: opts.profile,
    dest,
    extras,
  });

  return { destDir: dest, profile: opts.profile, extras };
}

/**
 * Spec 112 §5.3 + spec 220 AC-2: regenerate the produced app's codebase
 * index over the FINAL scaffold tree so commit #1 ships a fresh, committed
 * `.derived`.
 *
 * The generator (factory-encore `born-with.ts`) strips the template's
 * `.derived` on purpose: it must be recomputed against the PRODUCED tree,
 * which differs from the template (seeded specs, born-with `Makefile` +
 * `tools/lint`, the added `.github/workflows/oap-build.yml`, per-profile
 * modules). The produced app's own born-with CI gates on `spec-spine index
 * check` (spec 000-bootstrap); without a committed, fresh index that gate
 * exits 3 and the whole spec-spine job (including the spec 220 certificate
 * emission) never runs.
 *
 * Fail-closed (spec 209 posture, no skip-as-pass): compile + index, then
 * re-run `index check`; if the freshly generated index is not fresh the step
 * throws, so create.ts orphans the job rather than pushing a red-on-arrival
 * repo. Uses the pinned `spec-spine` from the template cache (`specSpineBin`)
 * so the committed shards match the version the produced app's CI checks
 * with. Runs after every tree mutation (scaffold, add-module, kernel stamp,
 * oap-build.yml seed, artifact extraction), all of which touch hashed index
 * inputs.
 */
export async function regenerateProducedIndex(opts: {
  /** The scaffold tree root (commit #1 working dir). */
  dest: string;
  /** Absolute path to the pinned `spec-spine` binary (template cache). */
  specSpineBin: string;
  /** Workspace dir, for the writable-path subprocess env. */
  workspaceDir: string;
  /** Optional progress sink. */
  log?: (line: string) => void;
}): Promise<void> {
  const env = tooledEnv(opts.workspaceDir);
  const sink = opts.log ?? (() => {});
  sink("spec-spine compile (regenerate registry)");
  await spawnAndCapture(opts.specSpineBin, ["compile"], opts.dest, env);
  sink("spec-spine index (regenerate codebase index)");
  await spawnAndCapture(opts.specSpineBin, ["index"], opts.dest, env);
  // Fail-closed freshness gate: what the produced app's CI will run must pass
  // here first, so a scaffold that cannot produce a fresh index fails
  // creation instead of shipping a repo whose very first CI run is red.
  sink("spec-spine index check (fail-closed freshness gate)");
  await spawnAndCapture(opts.specSpineBin, ["index", "check"], opts.dest, env);
}

/**
 * Spec 220 AC-2 / the born-with `Typed client up-to-date` gate (Option C):
 * regenerate the produced app's committed typed Encore client over the FINAL
 * composed graph, using the real Encore CLI.
 *
 * The generator ships the template's base-graph client verbatim (auth, gateway,
 * health, web) and cannot regenerate it offline: the scaffold runs the generator
 * under NO_INSTALL, and `encore gen client` needs both the Encore CLI and the
 * app's node_modules. A profile that composes a service-bearing module (internal
 * composes user-management, adding a `user_management` service) therefore ships a
 * client missing that namespace, and the produced app's own `client-staleness` CI
 * job -- which regenerates from apps/api and diffs -- fails on structural drift.
 *
 * This step closes that gap with the PVC-provisioned, version-pinned CLI
 * (warmup `ensureEncoreCli`): for every `apps/api` in the tree (single:
 * `<dest>/apps/api`; dual: `<dest>/{public,internal}/apps/api`), install deps and
 * run the app's own `gen:client` script -- the identical command the CI runs
 * (`npm --prefix apps/api run gen:client`), with the pinned `encore` on PATH -- so
 * the committed client matches what the CI regenerates (modulo the app-id prefix
 * and CLI-version string the CI normalizes). Runs before `regenerateProducedIndex`
 * so the committed index reflects the regenerated client. `npm install` (not
 * `--package-lock-only`) materializes node_modules AND reconciles the lockfile;
 * node_modules is gitignored, so it never rides commit #1.
 */
export async function regenerateProducedClient(opts: {
  /** The scaffold tree root (commit #1 working dir). */
  dest: string;
  /** Dir to prepend to PATH so `encore` resolves to the pinned PVC CLI. */
  encoreBinDir: string;
  /** Workspace dir, for the writable-path subprocess env. */
  workspaceDir: string;
  /** Optional progress sink. */
  log?: (line: string) => void;
}): Promise<void> {
  const sink = opts.log ?? (() => {});
  const apiDirs = await findGenClientApiDirs(opts.dest);
  if (apiDirs.length === 0) {
    sink("regenerate-client: no apps/api with a gen:client script; skipping");
    return;
  }
  const env = tooledEnv(opts.workspaceDir, {
    PATH: `${opts.encoreBinDir}:${process.env.PATH ?? ""}`,
  });
  for (const apiDir of apiDirs) {
    sink(`regenerate-client: npm install (${apiDir})`);
    await spawnAndCapture("npm", ["install"], apiDir, env);
    sink(`regenerate-client: gen:client (${apiDir})`);
    await spawnAndCapture("npm", ["run", "gen:client"], apiDir, env);
  }
}

/**
 * The `apps/api` dirs in the produced tree that carry a `gen:client` script.
 * Single-app profiles have `<dest>/apps/api`; the dual variant has two roots,
 * `<dest>/{public,internal}/apps/api`. Guarding on the script's presence keeps a
 * layout without it (or a future variant) from failing the regen step.
 */
async function findGenClientApiDirs(dest: string): Promise<string[]> {
  const candidates = [
    join(dest, "apps", "api"),
    join(dest, "public", "apps", "api"),
    join(dest, "internal", "apps", "api"),
  ];
  const found: string[] = [];
  for (const dir of candidates) {
    try {
      const pkg = JSON.parse(
        await readFile(join(dir, "package.json"), "utf8")
      ) as { scripts?: Record<string, string> };
      if (pkg.scripts?.["gen:client"]) found.push(dir);
    } catch {
      // no package.json here (dir absent for this layout)
    }
  }
  return found;
}

/**
 * Spec 209 FR-002 (born-with kernel completeness, fail-closed). After the
 * `.kernel-version` stamp is written, re-read and validate it: the file must
 * exist, parse as YAML, and carry a non-empty `spec_spine_version` plus a
 * complete adapter identity. A missing or partial kernel fails creation with
 * an attributable error rather than leaving a project that merely looks
 * governed. This is the in-OAP, production-path delivery of the spec 167
 * "auto-fire" guarantee; the engine `emit_project_kernel` transition stays
 * deliberately unwired (spec 167 §2.4/§7) to avoid a double-emit.
 */
async function assertBornWithKernelComplete(dest: string): Promise<void> {
  const path = join(dest, ".kernel-version");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `born-with kernel incomplete: .kernel-version missing at ${path} ` +
        `(spec 209 FR-002): ${msg}`
    );
  }
  let stamp: unknown;
  try {
    stamp = parseYaml(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `born-with kernel incomplete: .kernel-version is not valid YAML ` +
        `(spec 209 FR-002): ${msg}`
    );
  }
  const s = stamp as {
    kernel?: { spec_spine_version?: unknown };
    adapter?: { id?: unknown; version?: unknown; manifest_hash?: unknown };
  } | null;
  const checks: Array<[string, unknown]> = [
    ["kernel.spec_spine_version", s?.kernel?.spec_spine_version],
    ["adapter.id", s?.adapter?.id],
    ["adapter.version", s?.adapter?.version],
    ["adapter.manifest_hash", s?.adapter?.manifest_hash],
  ];
  const missing = checks
    .filter(([, v]) => typeof v !== "string" || v.length === 0)
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(
      `born-with kernel incomplete: .kernel-version missing or empty ` +
        `[${missing.join(", ")}] (spec 209 FR-002); a project cannot complete ` +
        `creation with a partial kernel`
    );
  }
}

/**
 * Spec 227 Stage 2: write user-supplied Base-app config values into every
 * `apps/api/.env.example` in the tree (single: `<dest>/apps/api`; dual:
 * `<dest>/{public,internal}/apps/api`). Only keys with a supplied value are
 * touched; a layout without the file is skipped. If a value was supplied but no
 * `.env.example` was found anywhere, warn (rather than silently drop the knob).
 */
async function applyBaseAppConfig(
  dest: string,
  config: PerRequestScaffoldOptions["baseAppConfig"],
  sink: (line: string) => void
): Promise<void> {
  const overrides: Record<string, string> = {};
  if (config?.privateApiBaseUrl) {
    overrides.PRIVATE_API_BASE_URL = config.privateApiBaseUrl;
  }
  if (config?.gatewayTimeoutMs !== undefined) {
    overrides.GATEWAY_TIMEOUT_MS = String(config.gatewayTimeoutMs);
  }
  // Spec 229 auth-driver axis: patch AUTH_DRIVER to the chosen app-level driver
  // (mock|rauthy). Deterministic; overrides the profile's baked default.
  if (config?.authDriver) {
    overrides.AUTH_DRIVER = config.authDriver;
  }
  if (Object.keys(overrides).length === 0) return;

  const candidates = [
    join(dest, "apps", "api", ".env.example"),
    join(dest, "public", "apps", "api", ".env.example"),
    join(dest, "internal", "apps", "api", ".env.example"),
  ];
  let patched = 0;
  for (const path of candidates) {
    let body: string;
    try {
      body = await readFile(path, "utf8");
    } catch {
      continue; // .env.example absent for this layout
    }
    await writeFile(path, patchEnvExample(body, overrides), "utf8");
    sink(`base-app config: patched ${path}`);
    patched += 1;
  }
  if (patched === 0) {
    log.warn(
      "scaffoldFromPrebuilt: base-app config supplied but no apps/api/.env.example found",
      { dest, keys: Object.keys(overrides) }
    );
  }
}

/** Module ids already present in the copied prebuild (from its template.json). */
async function readInstalledModules(dest: string): Promise<Set<string>> {
  try {
    const raw = await readFile(join(dest, "template.json"), "utf8");
    const parsed = JSON.parse(raw) as { modules?: Record<string, unknown> };
    return new Set(Object.keys(parsed.modules ?? {}));
  } catch {
    return new Set();
  }
}

function spawnAndCapture(
  bin: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv | undefined
): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    const proc = spawn(bin, args, {
      cwd,
      env: env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    proc.stdout.on("data", (d: Buffer) => chunks.push(d));
    proc.stderr.on("data", (d: Buffer) => chunks.push(d));
    proc.on("close", (code) => {
      if (code === 0) {
        resolveRun();
      } else {
        const tail = Buffer.concat(chunks).toString("utf8").slice(-2000);
        rejectRun(
          new Error(`${bin} ${args.join(" ")} exited ${code}: ${tail}`)
        );
      }
    });
    proc.on("error", rejectRun);
  });
}
