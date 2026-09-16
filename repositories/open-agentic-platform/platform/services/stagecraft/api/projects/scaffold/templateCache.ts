// Spec 112 §5.3 ops 1+2 + §5.3.1: two-cache warmup + SHA-stamped prebuilds.
//
// The generator-product split (spec 112 §5.3.1) moved the create-time
// generator (`scripts/`) and the module catalog (`modules/`) out of the
// scaffold-source repo (template-encore) into the factory-encore adapter, and
// left template-encore a lean baseline. Warmup therefore clones BOTH owned
// upstreams:
//
//   _factory-cache   factory-encore: adapters/acme-vue-encore/{scripts,modules}
//                    + tsx devDep (the generator + module catalog)
//   _template-cache  template-encore: lean apps/ + packages/ baseline (the
//                    `--source` the generator composes onto)
//
// then runs the adapter's manifest-declared entry point
// (`setup-app.ts --profile <p> --source _template-cache`, or `setup-dual-app.ts`
// for dual) to materialise the profile prebuilds. The generator reads
// `profiles[].modules` from the manifest itself (factory-encore STRUCT-1), so
// warmup passes only `--profile`, with no module translation of its own.
//
// Prebuilds are SHA-stamped, immutable snapshots behind an atomically-swapped
// `current` pointer: `_prebuilt/<combined-sha>/<profile>`. A refresh writes a
// new sha-dir and flips the pointer with rename; per-request copies resolve the
// current sha once and read an immutable tree, so a refresh can never expose a
// half-written prebuild to an in-flight copy. A single-flight guard prevents the
// startup warmup and the 30-min refresher from regenerating concurrently
// in-pod (the chart enforces single-pod warmup: RWO PVC, replicaCount=1).
//
// Both steps are idempotent on disk via per-cache SHA files (.template-commit,
// .factory-commit) and the combined-sha pointer. The Create endpoint reads
// getInitStatus() to decide whether to accept a request.

import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { resolve, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import log from "encore.dev/log";
import { PROFILES, type Profile } from "./moduleCatalog";

// ── Types ──────────────────────────────────────────────────────────────

export type InitStep =
  | "idle"
  | "cloning"
  | "cache-installing"
  | "building-minimal"
  | "building-public"
  | "building-internal"
  | "building-dual"
  | "ready"
  | "error";

export interface InitStatus {
  step: InitStep;
  progress: number;
  ready: boolean;
  error?: string;
}

export interface WarmupContext {
  /** Absolute path of the workspace dir; caches + prebuilts live underneath. */
  workspaceDir: string;
  /**
   * template-encore clone target (`<owner>/<repo>`), the lean baseline the
   * generator composes onto via `--source`. Resolved from the admitted
   * `scaffold.source` against `factory_upstreams` (spec 199 FR-009).
   */
  scaffoldRepoUrl: string;
  /** template-encore branch the cache pins to; the refresher polls this. */
  scaffoldRef: string;
  /**
   * factory-encore clone target (`<owner>/<repo>`), carrying the generator,
   * module catalog, and tsx (spec 112 §5.3.1). Read from the `factory`
   * `factory_upstreams` row: a configuration fact, not a new admission gate.
   */
  factoryRepoUrl: string;
  /** factory-encore branch the cache pins to; the refresher polls this. */
  factoryRef: string;
  /**
   * Async resolver for the plaintext PAT used to clone both owned upstreams
   * and read their branch heads. A single org PAT (the `factory_upstream_pats`
   * row) covers both repos.
   */
  patResolver: () => Promise<string | null>;
}

// ── Module-scoped state ────────────────────────────────────────────────

let initStatus: InitStatus = { step: "idle", progress: 0, ready: false };
let templateCacheReady = false;
let cacheRefreshing = false;
let warmupInFlight = false;
let backgroundRefresherStarted = false;

export function getInitStatus(): InitStatus {
  return { ...initStatus };
}

export function isTemplateCacheReady(): boolean {
  return templateCacheReady;
}

export function isTemplateCacheRefreshing(): boolean {
  return cacheRefreshing;
}

/**
 * Surface a warmup-blocked condition (no adapter manifest resolves a scaffold
 * source, no factory upstream configured, no PAT) through the readiness path.
 */
export function setInitErrorFromContext(reason: string): void {
  initStatus = { step: "error", progress: 0, ready: false, error: reason };
  templateCacheReady = false;
}

/** Test-only: reset the in-memory status flags. */
export function _resetForTests(): void {
  initStatus = { step: "idle", progress: 0, ready: false };
  templateCacheReady = false;
  cacheRefreshing = false;
  warmupInFlight = false;
  backgroundRefresherStarted = false;
}

// ── Path helpers ───────────────────────────────────────────────────────

export function defaultWorkspaceDir(): string {
  return resolve(process.env.statecraft_WORKSPACE_DIR ?? "./workspace");
}

/** template-encore checkout: the `--source` baseline. */
function templateCacheDir(workspace: string): string {
  return join(workspace, "_template-cache");
}

/** factory-encore checkout: the generator + module catalog + tsx. */
function factoryCacheDir(workspace: string): string {
  return join(workspace, "_factory-cache");
}

/**
 * The pinned `spec-spine` binary the warmup installed into the template
 * cache (the template's exact-pinned devDependency, spec 167). The scaffold
 * regenerates the produced app's `.derived` index with THIS binary so the
 * committed index matches the version the produced app's own born-with CI
 * runs `spec-spine index check` with (spec 112 / spec 220 AC-2).
 */
export function specSpineBin(workspace: string): string {
  return join(templateCacheDir(workspace), "node_modules", ".bin", "spec-spine");
}

/**
 * Fallback Encore CLI version if the template cache's `encore.dev` pin cannot be
 * read. Keep in lockstep with template-encore `apps/api` `encore.dev` and the
 * born-with `encore-install` action default (spec 220 AC-2 client-parity).
 */
const DEFAULT_ENCORE_CLI_VERSION = "1.57.9";

/**
 * Install root for the Encore CLI, under `<workspace>/.home/.encore`. We extract
 * the release tarball here (it lays out `bin/encore`), matching the layout
 * Encore's own install.sh uses under `$HOME/.encore`. Lives on the writable PVC
 * (the pod is `readOnlyRootFilesystem: true`).
 */
function encoreInstallRoot(workspace: string): string {
  return join(workspace, ".home", ".encore");
}

/** The PVC-provisioned Encore CLI binary (spec 220 Option C). */
export function encoreBin(workspace: string): string {
  return join(encoreInstallRoot(workspace), "bin", "encore");
}

/** The dir to prepend to PATH so `encore gen client` resolves the pinned CLI. */
export function encoreBinDir(workspace: string): string {
  return join(encoreInstallRoot(workspace), "bin");
}

/** Marker recording which pinned version is installed (idempotency). */
function encoreVersionMarker(workspace: string): string {
  return join(encoreInstallRoot(workspace), ".installed-version");
}

/** The adapter's scripts dir inside the factory cache. */
function adapterScriptsDir(workspace: string): string {
  return join(
    factoryCacheDir(workspace),
    "adapters",
    "acme-vue-encore",
    "scripts"
  );
}

function templateCommitFile(workspace: string): string {
  return join(workspace, ".template-commit");
}

function factoryCommitFile(workspace: string): string {
  return join(workspace, ".factory-commit");
}

/** Root under which SHA-stamped immutable prebuild snapshots live. */
function prebuiltRootDir(workspace: string): string {
  return join(workspace, "_prebuilt");
}

/** The `current` pointer file: contains the live combined-sha. */
function currentPointerFile(workspace: string): string {
  return join(prebuiltRootDir(workspace), "current");
}

/** A specific immutable snapshot's per-profile tree. */
export function prebuiltDir(
  workspace: string,
  combined: string,
  profile: Profile
): string {
  return join(prebuiltRootDir(workspace), combined, profile);
}

/** The combined cache key for the two upstream SHAs (short, readable). */
function combinedSha(templateSha: string, factorySha: string): string {
  return `${templateSha.slice(0, 12)}-${factorySha.slice(0, 12)}`;
}

/**
 * The combined-sha the `current` pointer references, or null if no prebuild
 * snapshot has been published yet. Per-request copies resolve this ONCE at the
 * start so they read a stable, immutable snapshot for the whole request.
 */
export async function resolveCurrentPrebuiltSha(
  workspace: string
): Promise<string | null> {
  return readShaFile(currentPointerFile(workspace));
}

/**
 * Build a subprocess env that routes npm + node tooling at writable paths. The
 * pod has readOnlyRootFilesystem and no $HOME, so npm/tsx must write under the
 * workspace PVC.
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

async function ensureToolingDirs(workspace: string): Promise<void> {
  for (const d of [".npm-cache", ".home", ".xdg-cache"]) {
    await mkdir(join(workspace, d), { recursive: true });
  }
}

// ── Public surface ─────────────────────────────────────────────────────

/**
 * Clone (or refresh in place if upstream advanced) both owned upstream caches
 * and `npm install` each. Idempotent on disk SHA. Clones under a temp dir and
 * renames into place so in-flight reads are never disrupted.
 */
export async function ensureTemplateCache(ctx: WarmupContext): Promise<void> {
  if (cacheRefreshing) {
    while (cacheRefreshing) await sleep(500);
    return;
  }
  cacheRefreshing = true;
  templateCacheReady = false;
  try {
    const factorySha = await ensureOneCache(ctx, {
      repoUrl: ctx.factoryRepoUrl,
      ref: ctx.factoryRef,
      dir: factoryCacheDir(ctx.workspaceDir),
      commitFile: factoryCommitFile(ctx.workspaceDir),
      label: "factory cache",
    });
    const templateSha = await ensureOneCache(ctx, {
      repoUrl: ctx.scaffoldRepoUrl,
      ref: ctx.scaffoldRef,
      dir: templateCacheDir(ctx.workspaceDir),
      commitFile: templateCommitFile(ctx.workspaceDir),
      label: "template cache",
    });
    templateCacheReady = true;
    log.info("caches: ready", {
      template: ctx.scaffoldRepoUrl,
      templateSha,
      factory: ctx.factoryRepoUrl,
      factorySha,
    });
  } catch (err) {
    initStatus = { step: "error", progress: 0, ready: false, error: errMsg(err) };
    throw err;
  } finally {
    cacheRefreshing = false;
  }
}

/**
 * The `encore.dev` runtime version the template pins (e.g. "1.57.9"), read from
 * the template cache. The scaffold installs THIS CLI version so the client it
 * generates is structurally identical to the one the produced app's own CI
 * regenerates and checks (spec 220 AC-2). Falls back to the pinned default if
 * the cache is not yet present or the field is missing.
 */
async function resolveEncoreCliVersion(workspace: string): Promise<string> {
  try {
    const raw = await readFile(
      join(templateCacheDir(workspace), "apps", "api", "package.json"),
      "utf8"
    );
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const spec =
      pkg.dependencies?.["encore.dev"] ?? pkg.devDependencies?.["encore.dev"];
    const m = spec?.match(/(\d+\.\d+\.\d+)/);
    if (m) return m[1];
    log.warn(
      "encore CLI: no encore.dev semver in template package.json; using default",
      { default: DEFAULT_ENCORE_CLI_VERSION, spec }
    );
  } catch (err) {
    // ensureEncoreCli runs AFTER ensureTemplateCache, so the cache should be
    // present here; a read/parse failure is anomalous. Warn rather than fall
    // through silently, so a stale or mismatched pin is diagnosable in the logs.
    log.warn(
      "encore CLI: template package.json unreadable; using default version",
      { default: DEFAULT_ENCORE_CLI_VERSION, error: errMsg(err) }
    );
  }
  return DEFAULT_ENCORE_CLI_VERSION;
}

/**
 * Provision the Encore CLI into the PVC (one-time per pod, idempotent on the
 * pinned version). The CLI is a standalone Go binary, NOT an npm package, so it
 * cannot ride the template cache's `npm install` the way `spec-spine` does, and
 * the statecraft runtime image is slim (no curl/wget), so Encore's curl-based
 * install.sh is unusable here. We download the pinned release tarball with
 * node's global `fetch` (streamed to disk to avoid buffering ~160MB) and extract
 * it with `tar` (present in the image); the tarball lays out `bin/encore` under
 * the install root, matching `encoreBin()`. Egress is HTTPS/443, allowed by the
 * statecraft NetworkPolicy's general-HTTPS rule.
 *
 * Version-pinned to the template's `encore.dev` runtime so the client the
 * scaffold generates matches the one the produced app's own `Typed client
 * up-to-date` CI job regenerates (spec 220 AC-2 / Option C).
 *
 * Fail-closed and fail-LOUD: the marker is written only after the binary is
 * confirmed present at `encoreBin`, so a partial or failed download can never
 * masquerade as a ready CLI. (An earlier `curl | bash` recipe masked a
 * missing-curl failure as exit 0 because the pipe returns bash's status, not
 * curl's.) A pod that cannot provision the CLI surfaces the failure through
 * initStatus, blocking Create rather than shipping a born-red repo.
 */
export async function ensureEncoreCli(ctx: WarmupContext): Promise<void> {
  const workspace = ctx.workspaceDir;
  const want = await resolveEncoreCliVersion(workspace);
  const bin = encoreBin(workspace);
  const marker = encoreVersionMarker(workspace);

  if ((await readShaFile(marker)) === want && (await pathExists(bin))) {
    log.info("encore CLI: already installed", { version: want });
    return;
  }

  try {
    const installRoot = encoreInstallRoot(workspace);
    await ensureToolingDirs(workspace);
    await mkdir(installRoot, { recursive: true });

    // The CloudFront distribution and `encore-<version>-<target>.tar.gz` naming
    // are Encore's own release layout, taken verbatim from its published
    // install.sh (https://encore.dev/install.sh, the ENCORE_INSTALL_VERSION
    // path). The tarball is FLAT-rooted -- verified: `./bin/encore`,
    // `./encore-go/`, `./runtimes/` all sit at the archive root -- so
    // `tar -C installRoot` lands the binary at `installRoot/bin/encore` ==
    // encoreBin(), with no `--strip-components`. Integrity rests on TLS to the
    // CDN, at parity with Encore's own installer (which likewise does not verify
    // a checksum); Encore publishes no per-release SHA-256 at a stable URL to
    // check against before extract, so that hardening is deferred.
    const target = encoreReleaseTarget();
    const url = `https://d2f391esomvqpi.cloudfront.net/encore-${want}-${target}.tar.gz`;
    const tgz = join(installRoot, "encore.tar.gz");
    log.info("encore CLI: downloading", { version: want, target, url });

    // Bound the transfer so an unresponsive or stalled CDN cannot hang the
    // warmup pod indefinitely. Generous for a ~160MB body over slow egress; the
    // signal aborts the fetch and its streamed body. Cleared once the download
    // and extract complete.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 300_000);
    try {
      const resp = await fetch(url, { signal: ac.signal });
      if (!resp.ok || !resp.body) {
        throw new Error(
          `encore CLI download failed: HTTP ${resp.status} ${resp.statusText} (${url})`
        );
      }
      await pipeline(Readable.fromWeb(resp.body), createWriteStream(tgz));
      await spawnLogged(
        "tar",
        ["-C", installRoot, "-xzf", tgz],
        workspace,
        tooledEnv(workspace),
        undefined
      );
    } finally {
      clearTimeout(timer);
      // Always drop the tarball -- including on a fetch/extract failure -- so a
      // partial ~160MB download never accumulates on the finite PVC.
      await rm(tgz, { force: true }).catch(() => {});
    }

    // Fail LOUD if the binary is not where we expect: never write the marker on
    // a partial install. This is the guard the old `curl | bash` recipe lacked.
    if (!(await pathExists(bin))) {
      throw new Error(
        `encore CLI install incomplete: binary absent at ${bin} after extracting ${url}`
      );
    }
    // Best-effort: telemetry off (never fail the warmup on this).
    await spawnLogged(
      bin,
      ["telemetry", "disable"],
      workspace,
      tooledEnv(workspace),
      undefined
    ).catch(() => {});
    await writeFile(marker, want, "utf8");
    log.info("encore CLI: ready", { version: want, bin });
  } catch (err) {
    initStatus = { step: "error", progress: 0, ready: false, error: errMsg(err) };
    templateCacheReady = false;
    throw err;
  }
}

/**
 * The Encore release target for this host, mirroring install.sh's arch map. The
 * statecraft runtime image is Linux; node's `process.arch` is `x64` or `arm64`.
 */
function encoreReleaseTarget(): string {
  return process.arch === "arm64" ? "linux_arm64" : "linux_amd64";
}

interface CacheSpec {
  repoUrl: string;
  ref: string;
  dir: string;
  commitFile: string;
  label: string;
}

/**
 * Clone+install one upstream cache, idempotent on its recorded SHA. Returns the
 * SHA now on disk for that cache (used to compute the combined prebuild key).
 */
async function ensureOneCache(
  ctx: WarmupContext,
  spec: CacheSpec
): Promise<string | null> {
  const cachedSha = await readShaFile(spec.commitFile);
  const latestSha = await fetchLatestCommit(ctx, spec.repoUrl, spec.ref);
  if ((await pathExists(spec.dir)) && !!latestSha && cachedSha === latestSha) {
    log.info(`${spec.label}: already up to date`, {
      remote: spec.repoUrl,
      sha: cachedSha,
    });
    return cachedSha;
  }

  initStatus = { step: "cloning", progress: 5, ready: false };
  await mkdir(ctx.workspaceDir, { recursive: true });
  await ensureToolingDirs(ctx.workspaceDir);
  const tempDir = spec.dir + "_new";
  await rm(tempDir, { recursive: true, force: true }).catch(() => {});

  const token = await ctx.patResolver();
  const cloneUrl = buildCloneUrl(spec.repoUrl, token);
  const env = tooledEnv(ctx.workspaceDir);

  log.info(`${spec.label}: cloning`, { remote: spec.repoUrl, branch: spec.ref });
  await spawnLogged(
    "git",
    ["clone", "--branch", spec.ref, "--depth", "1", cloneUrl, tempDir],
    ctx.workspaceDir,
    env,
    token ?? undefined
  );

  initStatus = { step: "cache-installing", progress: 15, ready: false };
  log.info(`${spec.label}: npm install`);
  await spawnLogged("npm", ["install"], tempDir, env, undefined);

  if (await pathExists(spec.dir)) {
    await rm(spec.dir, { recursive: true, force: true });
  }
  await rename(tempDir, spec.dir);
  if (latestSha) await writeFile(spec.commitFile, latestSha, "utf8");
  log.info(`${spec.label}: ready`, { remote: spec.repoUrl, sha: latestSha });
  return latestSha;
}

/**
 * Materialise the four profile prebuilds as a SHA-stamped immutable snapshot,
 * running the factory-cache generator with the template cache as `--source`.
 * Idempotent when the current pointer already matches the combined SHA.
 * Publishes by atomic pointer swap and GCs stale snapshots.
 */
export async function ensurePrebuilts(ctx: WarmupContext): Promise<void> {
  const templateSha = await readShaFile(templateCommitFile(ctx.workspaceDir));
  const factorySha = await readShaFile(factoryCommitFile(ctx.workspaceDir));
  if (!templateSha || !factorySha) {
    throw new Error("ensurePrebuilts: caches not populated (missing commit sha)");
  }
  // The shas become a filesystem path component (the snapshot dir). They come
  // from the GitHub API / the cache commit files, but validate them as hex so a
  // tampered commit file can never inject a path separator or `..` traversal.
  for (const [label, sha] of [
    ["template", templateSha],
    ["factory", factorySha],
  ] as const) {
    if (!/^[0-9a-f]{7,64}$/i.test(sha)) {
      throw new Error(
        `ensurePrebuilts: ${label} commit sha is not a hex sha (got ${JSON.stringify(sha)})`
      );
    }
  }
  const combined = combinedSha(templateSha, factorySha);
  const snapshotDir = join(prebuiltRootDir(ctx.workspaceDir), combined);

  const currentSha = await resolveCurrentPrebuiltSha(ctx.workspaceDir);
  const allExist = await Promise.all(
    PROFILES.map((p) => pathExists(prebuiltDir(ctx.workspaceDir, combined, p)))
  );
  if (currentSha === combined && allExist.every(Boolean)) {
    initStatus = { step: "ready", progress: 100, ready: true };
    log.info("prebuilts: already up to date", { sha: combined });
    return;
  }

  const scriptsDir = adapterScriptsDir(ctx.workspaceDir);
  const tsx = join(
    factoryCacheDir(ctx.workspaceDir),
    "node_modules",
    "tsx",
    "dist",
    "cli.mjs"
  );
  await ensureToolingDirs(ctx.workspaceDir);
  const prebuiltEnv = tooledEnv(ctx.workspaceDir, {
    NODE_PATH: join(factoryCacheDir(ctx.workspaceDir), "node_modules"),
    NO_INSTALL: "true",
  });
  const source = templateCacheDir(ctx.workspaceDir);

  // Generator reads profiles[].modules from the manifest itself, so warmup
  // passes only --profile (no --with translation): an internal prebuild ships
  // user-management because the generator composed it. dual takes no profile.
  type ProfileSpec = { name: Profile; script: string; args: string[] };
  const PROFILE_SPECS: ProfileSpec[] = [
    { name: "minimal", script: "setup-app.ts", args: ["--profile", "minimal"] },
    { name: "public", script: "setup-app.ts", args: ["--profile", "public"] },
    { name: "internal", script: "setup-app.ts", args: ["--profile", "internal"] },
    { name: "dual", script: "setup-dual-app.ts", args: [] },
  ];

  // Build into a fresh staging dir; publish by rename + pointer swap so an
  // in-flight per-request copy of the previous snapshot is never disturbed.
  const stagingDir = snapshotDir + "_new";
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });

  for (const [i, spec] of PROFILE_SPECS.entries()) {
    const dest = join(stagingDir, spec.name);
    initStatus = {
      step: `building-${spec.name}` as InitStep,
      progress: 20 + i * 20,
      ready: false,
    };
    log.info("prebuilt: building", { profile: spec.name, dest });
    try {
      await spawnLogged(
        process.execPath,
        [
          tsx,
          join(scriptsDir, spec.script),
          ...spec.args,
          "--source",
          source,
          "--dest",
          dest,
          "--yes",
        ],
        scriptsDir,
        prebuiltEnv,
        undefined
      );
    } catch (err) {
      initStatus = {
        step: "error",
        progress: 20 + i * 20,
        ready: false,
        error: `${spec.name} build failed: ${errMsg(err)}`,
      };
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
  }

  // Publish atomically: rename staging into the snapshot, then flip the pointer.
  if (await pathExists(snapshotDir)) {
    await rm(snapshotDir, { recursive: true, force: true });
  }
  await rename(stagingDir, snapshotDir);
  await writePointer(ctx.workspaceDir, combined);
  // Keep the new snapshot and the previous pointer's snapshot (grace window
  // for in-flight copies); drop anything older.
  await gcOldSnapshots(
    ctx.workspaceDir,
    [combined, currentSha].filter((s): s is string => s !== null)
  );

  initStatus = { step: "ready", progress: 100, ready: true };
  log.info("prebuilts: published", { sha: combined });
}

/**
 * One-shot warmup: caches then prebuilds. Single-flight across the startup hook
 * and the background refresher. Does not throw; failures land in
 * initStatus.error so Create surfaces them via the readiness endpoint.
 */
export async function runWarmup(ctx: WarmupContext): Promise<void> {
  if (warmupInFlight) {
    log.info("warmup: already in flight, skipping");
    return;
  }
  warmupInFlight = true;
  try {
    await ensureTemplateCache(ctx);
    // Provision the pinned Encore CLI (spec 220 Option C) after the template
    // cache exists (its `encore.dev` pin is the version source) and before
    // prebuilds. Per-request scaffolds use it to regenerate the produced app's
    // typed client over the final composed graph.
    await ensureEncoreCli(ctx);
    await ensurePrebuilts(ctx);
  } catch (err) {
    log.warn("scaffold warmup failed", { error: errMsg(err) });
  } finally {
    warmupInFlight = false;
  }
}

/** Start the 30-min refresher (idempotent). Polls both upstreams' heads. */
export function startBackgroundRefresher(ctx: WarmupContext): void {
  if (backgroundRefresherStarted) return;
  backgroundRefresherStarted = true;
  const interval = setInterval(() => {
    runWarmup(ctx).catch((err) => {
      log.warn("background refresher cycle failed", { error: errMsg(err) });
    });
  }, 30 * 60_000);
  if (typeof interval.unref === "function") interval.unref();
}

// ── Internal helpers ───────────────────────────────────────────────────

/** Atomically write the `current` pointer (temp file + rename). */
async function writePointer(workspace: string, combined: string): Promise<void> {
  await mkdir(prebuiltRootDir(workspace), { recursive: true });
  const tmp = currentPointerFile(workspace) + ".tmp";
  await writeFile(tmp, combined, "utf8");
  await rename(tmp, currentPointerFile(workspace));
}

/**
 * Remove stale snapshot dirs, keeping the current one and the single most
 * recent other (a grace window for any per-request copy that resolved the
 * previous pointer before the swap; copies complete in seconds, far inside the
 * 30-min refresh cadence).
 */
async function gcOldSnapshots(
  workspace: string,
  keep: string[]
): Promise<void> {
  const keepSet = new Set(keep);
  const root = prebuiltRootDir(workspace);
  let entries: string[];
  try {
    entries = (await readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return;
  }
  // Keep the new snapshot AND the immediately-previous one (the pointer value
  // before this publish): an in-flight per-request copy that resolved the
  // previous pointer must still find its immutable snapshot. Selecting by an
  // explicit keep-set (not readdir order, which is unspecified) makes this
  // deterministic. Everything older is removed.
  for (const name of entries) {
    if (keepSet.has(name)) continue;
    await rm(join(root, name), { recursive: true, force: true }).catch(() => {});
  }
}

async function fetchLatestCommit(
  ctx: WarmupContext,
  repoUrl: string,
  ref: string
): Promise<string | null> {
  const [owner, repo] = repoUrl.split("/");
  if (!owner || !repo) return null;
  const token = await ctx.patResolver().catch(() => null);
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const resp = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/branches/${encodeURIComponent(ref)}`,
      { headers }
    );
    if (!resp.ok) {
      log.warn("head lookup failed", { remote: repoUrl, status: resp.status });
      return null;
    }
    const data = (await resp.json()) as { commit?: { sha?: string } };
    return data.commit?.sha ?? null;
  } catch (err) {
    log.warn("head lookup threw", { remote: repoUrl, error: errMsg(err) });
    return null;
  }
}

function buildCloneUrl(remote: string, token: string | null): string {
  if (token) return `https://x-access-token:${token}@github.com/${remote}.git`;
  return `https://github.com/${remote}.git`;
}

function spawnLogged(
  bin: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv | undefined,
  redactToken: string | undefined
): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    const proc = spawn(bin, args, {
      cwd,
      env: env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const tail: string[] = [];
    const pushTail = (line: string) => {
      const safe = redactToken ? line.replaceAll(redactToken, "***") : line;
      tail.push(safe);
      while (tail.length > 40) tail.shift();
    };
    let buf = "";
    const onData = (d: Buffer) => {
      buf += d.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        if (line) pushTail(line);
        buf = buf.slice(nl + 1);
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("close", (code) => {
      if (buf.trim()) pushTail(buf.trim());
      if (code === 0) {
        resolveRun();
      } else {
        // Redact the token from the argv too (the clone URL embeds it): the
        // tail is already redacted, but args.join would otherwise leak the PAT
        // into initStatus.error and the warn log.
        const safeArgs = redactToken
          ? args.map((a) => a.replaceAll(redactToken, "***"))
          : args;
        const detail = tail.slice(-10).join(" | ");
        rejectRun(
          new Error(
            `${bin} ${safeArgs.join(" ")} exited ${code}${detail ? `: ${detail}` : ""}`
          )
        );
      }
    });
    proc.on("error", rejectRun);
  });
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function readShaFile(p: string): Promise<string | null> {
  try {
    return (await readFile(p, "utf8")).trim();
  } catch {
    return null;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
