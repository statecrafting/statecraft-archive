// The build stage (spec 016): the first pipeline stage. Preflights refuse
// before anything starts (B-1); the orchestrator itself creates the branch
// and flips the target spec's frontmatter to in-progress before any session
// runs (B-2, "orchestrator-owned bracket"); a versioned prompt assembles the
// spec body, the backlog protocol, and scope-matched decisions (B-3); one
// fresh session drives the implementation, with at most one remediation
// session on a red post-session gate (B-4); the orchestrator itself judges
// completion from gate evidence and the spec's own frontmatter, never from
// the session's own claim (B-5); decisions dropped during the session are
// sealed at stage end (B-6, spec 020).
//
// Every side effect (git, gate commands, file edits, session driving) sits
// behind the Runner seam (FR-001): the production Runner spawns real
// processes (Bun.spawnSync) and touches the real filesystem; tests drive
// this module against a scripted fake Runner (and, where a session needs to
// look real, a fake `claude` script per spec 014's own convention), never
// the real `claude` binary.
import * as fs from "fs";
import { basename, join } from "path";
import type { JournalHandle, JsonValue } from "../journal";
import { createProcessDriver, type Driver, type SessionResult } from "../driver";
import type { ModelTier } from "../models";
import { profilePayload, resolveProfileSource, type ProfileSource } from "../profile";
import {
  candidatePath,
  changedPaths,
  closeCandidate,
  fencedEnv,
  openCandidate,
  originUrl,
  WITHOUT_REPOSITORY_HOOKS,
} from "../candidate";
import {
  FENCE_MESSAGES,
  NO_FENCE_TALLY,
  openFenceChannel,
  toolsBetween,
  type FenceChannel,
  type FencedTool,
  type FenceTally,
} from "../fence";
import { latestReceipt, mintReceipt, receiptPayload, RECEIPT_KIND, SENSITIVE_KIND, UNSTABLE_KIND, type Receipt } from "../receipt";
import { buildCapsule, renderCapsule } from "../handoff";
import type { CostCeiling } from "../budget";
import {
  GATE_COMMANDS,
  gatePayload,
  gateSuiteFor,
  resolveGateBinding,
  type AnyGateContract,
  type GateBinding,
} from "../gate-contract";
import {
  decisionRecordsFromChain,
  decisionsFor,
  sealDropbox,
  type DecisionsForResult,
  type SealDropboxResult,
} from "../decisions";

// --- Runner seam (FR-001) --------------------------------------------------

export interface GateResult {
  readonly exitCode: number;
  readonly stdoutTail: string;
  readonly stderrTail: string;
}

export interface RunnerSessionOptions {
  readonly prompt: string;
  // 043 B-1: a tier the driver resolves, or an explicit id that wins.
  readonly tier?: ModelTier;
  readonly model?: string;
  readonly maxTurns?: number;
  readonly timeoutMs?: number;
  readonly journal?: JournalHandle;
}

export interface Runner {
  // --- git ops ---
  statusClean(): boolean;
  currentBranch(): string;
  // Idempotent (FR-003 reconcile): creates and checks out `branch` when it
  // does not exist yet; when it already does (a crashed prior attempt),
  // simply checks it out instead of erroring. Returns true when the branch
  // was reused rather than freshly created.
  createBranch(branch: string): boolean;
  checkout(branch: string): void;
  add(paths: readonly string[]): void;
  commit(message: string): void;
  headSha(): string;
  // Fast-forward the current branch from its upstream when one exists;
  // throws on divergence (the preflight treats that as a refusal, never a
  // silent merge). A branch with no upstream cannot be stale: no-op.
  pullFfOnly(): void;
  // 119 B-2: the base the coupling gate compares against, resolved to a
  // commit once per stage run. Fetches `origin/<branch>` when a remote
  // answers, else the local branch (119 D-5); throws when neither resolves.
  resolveBase(defaultBranch: string): string;

  // --- the candidate (121 B-1, B-2) ---
  // Null when this runner works the checkout in place (a fixture world, or
  // a runner built without a candidate home, 121 D-5); otherwise the
  // candidate operations below apply and every other operation works the
  // open candidate.
  candidateHome(): string | null;
  // Opens (or reopens) the candidate worktree for `branch` from `baseSha`
  // and points every other operation at it. Returns 016 B-2's `reused`.
  openCandidate(branch: string, baseSha: string): { path: string; reused: boolean };
  // The open candidate's path, or the checkout when none is open.
  workDir(): string;
  // Removes the candidate worktree for `branch` and points the runner back
  // at the checkout.
  closeCandidate(branch: string): void;
  // Repository-relative paths changed between two revisions (121 B-5).
  changedPaths(baseSha: string, headSha: string): readonly string[];
  // The repository's origin URL, or null (121 B-5).
  originUrl(): string | null;
  // `git status --porcelain` verbatim, for the stability check (121 B-4).
  statusText(): string;

  // --- gate commands ---
  runGate(cmd: readonly string[]): GateResult;

  // --- file edits (repo-relative paths) ---
  readFile(path: string): string;
  writeFile(path: string, content: string): void;

  // --- session driving (delegates to spec 014's driver) ---
  runSession(options: RunnerSessionOptions): Promise<SessionResult>;

  // 125 B-7: how many times the fence refused a session since the fence was
  // built. A non-zero count is a session that tried to publish around the
  // broker, which is the signal that a prompt still asks for what the
  // boundary forbids. Zero in the in-place mode, which has no fence (121 D-5).
  // 129 B-3: read from the supervisor's count, never the log, and without
  // the refusals of the processes the runner spawned itself (the gate, the
  // engine's git), which are the gate's to account for.
  //
  // Optional for the same reason `candidateHome` may be null: a fixture
  // Runner is a world without candidates, and requiring the method would
  // make 125 edit test doubles owned by 021 and 026 for no behavior.
  fenceRefusals?(): number;

  // 129 B-3: the supervisor's whole count for the open fence, gate and
  // session alike, and whether a fence is applied at all. A stage reads it
  // immediately before and after the gate suite; the difference is the
  // gate's. Optional for fenceRefusals's reason; absent reads as no fence.
  fenceTally?(): RunnerFenceTally;
}

export interface RunnerFenceTally extends FenceTally {
  readonly applied: boolean;
}

const NO_RUNNER_FENCE: RunnerFenceTally = { applied: false, ...NO_FENCE_TALLY };

// 129 B-3: the fence record on gate and verify evidence. Required, with an
// explicit zero (125 D-3's rule): a missing count must not read as "nothing
// was refused".
export interface FenceRecord {
  readonly applied: boolean;
  readonly refusals: number;
}

// 129 B-4: why a round whose commands may all have exited 0 is not accepted.
export const GATE_FENCE_REFUSED = "gate-fence-refused";
export const FENCE_REFUSED_KIND = "acceptance.fence-refused";

export interface GateFenceRefusal {
  readonly reason: typeof GATE_FENCE_REFUSED;
  readonly refusals: number;
  readonly tools: readonly FencedTool[];
}

const GATE_TAIL_BYTES = 16 * 1024;

function tailText(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= maxBytes) return text;
  return new TextDecoder().decode(bytes.subarray(bytes.length - maxBytes));
}

// `env` absent is the daemon's own environment, which only the credentialed
// git below keeps (129 B-7); everything that runs repository-controlled code
// passes the fenced one.
function runProcessSync(
  cwd: string,
  cmd: readonly string[],
  env?: Record<string, string>
): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(cmd as string[], env === undefined ? { cwd } : { cwd, env });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

function requireOk(cwd: string, cmd: readonly string[], label: string, env?: Record<string, string>): void {
  const result = runProcessSync(cwd, cmd, env);
  if (result.exitCode !== 0) {
    throw new Error(`build: ${label} failed (exit ${result.exitCode}): ${result.stderr.trim()}`);
  }
}

// 119 B-2 / D-5: `origin/<branch>` after a fetch when the remote answers,
// else the local branch (a fixture world, or a checkout with no remote).
// Neither resolving is an error the preflight turns into `base-unresolved`.
// 129 B-7: the fetch keeps the daemon's credential and runs no repository hook.
export function resolveBaseSha(repoDir: string, defaultBranch: string): string {
  const remote = runProcessSync(repoDir, ["git", ...WITHOUT_REPOSITORY_HOOKS, "fetch", "--quiet", "origin", defaultBranch]);
  if (remote.exitCode === 0) {
    const ref = runProcessSync(repoDir, ["git", "rev-parse", "--verify", `origin/${defaultBranch}^{commit}`]);
    if (ref.exitCode === 0) return ref.stdout.trim();
  }
  const local = runProcessSync(repoDir, ["git", "rev-parse", "--verify", `${defaultBranch}^{commit}`]);
  if (local.exitCode === 0) return local.stdout.trim();
  throw new Error(
    `base "${defaultBranch}" resolves neither at origin nor locally: ${(remote.stderr || local.stderr).trim()}`
  );
}

export interface CreateProcessRunnerParams {
  readonly repoDir: string;
  // 043 B-1: the one seam a session is driven through. Absent is the
  // production process driver over the discovered driver member (043 B-5).
  readonly driver?: Driver;
  // The owning project's execution posture (spec 032 B-4), read at spawn
  // time when passed as a function. Absent derives 032 D-1's default, which
  // is the argv this runner produced before profiles existed. Ship and
  // shepherd drive their sessions through this same Runner, so threading it
  // here covers all three stages.
  readonly profile?: ProfileSource;
  // 121 B-1: where candidates live. Present, the build opens a worktree per
  // spec branch under <candidateHome>/candidates/<project>/<branch> and every
  // stage works it; absent, the runner works the checkout in place (121 D-5).
  readonly candidateHome?: string;
  // The project name the candidate path is keyed by; the checkout's
  // basename when absent.
  readonly project?: string;
}

// The production Runner: Bun.spawnSync for git and gate commands, fs for
// file edits, and spec 014's own runSession for driving. Never constructed
// by build.test.ts's fake-session/fake-gate scenarios (those override
// runGate/runSession on top of this); AC-2's real-git fixture flow reuses
// this wholesale for the git half so the reconcile and preflight paths run
// against a genuine repository.
export function createProcessRunner(params: CreateProcessRunnerParams): Runner {
  const { repoDir } = params;
  const driver = params.driver ?? createProcessDriver();
  const candidateHome = params.candidateHome ?? null;
  const project = params.project ?? basename(repoDir);
  // 121 B-2: the directory every operation below works. The checkout until
  // a candidate is opened; the candidate thereafter.
  let workDir = repoDir;
  // 125 B-2: the fence beside the open candidate, null until one is opened
  // and in the in-place mode that never opens one.
  let fenceDir: string | null = null;
  // 129 B-3: this runner is the supervisor of everything it fences, the
  // session and the gate alike. Opened with the first candidate and reset
  // each time the fence is rebuilt, as the log is.
  let channel: FenceChannel | null = null;
  // Refusals counted while one of this runner's own synchronous spawns ran
  // (a gate command, the engine's git): the gate's or the engine's, never a
  // session's, so fenceRefusals() leaves them out.
  let spawnedRefusals = 0;

  const tally = (): FenceTally => (fenceDir === null || channel === null ? NO_FENCE_TALLY : channel.tally());

  // 129 B-1, B-6: a process the runner spawns inside the candidate (a gate
  // command, the engine's git) receives exactly what the session receives.
  const runFenced = (cmd: readonly string[]): { exitCode: number; stdout: string; stderr: string } => {
    const before = tally().refusals;
    const result = runProcessSync(workDir, cmd, fencedEnv(fenceDir));
    spawnedRefusals += tally().refusals - before;
    return result;
  };
  const requireFenced = (cmd: readonly string[], label: string): void => {
    const result = runFenced(cmd);
    if (result.exitCode !== 0) {
      throw new Error(`build: ${label} failed (exit ${result.exitCode}): ${result.stderr.trim()}`);
    }
  };

  return {
    candidateHome(): string | null {
      return candidateHome;
    },

    openCandidate(branch: string, baseSha: string): { path: string; reused: boolean } {
      if (candidateHome === null) {
        // In-place mode (D-5): the branch is created or reused in the
        // checkout, as 016 B-2 did before candidates existed.
        const reused = this.createBranch(branch);
        return { path: repoDir, reused };
      }
      channel ??= openFenceChannel();
      const candidate = openCandidate({ repoDir, homeDir: candidateHome, project, branch, baseSha, channel });
      workDir = candidate.path;
      fenceDir = candidate.fenceDir;
      spawnedRefusals = 0;
      return { path: candidate.path, reused: candidate.reused };
    },

    workDir(): string {
      return workDir;
    },

    closeCandidate(branch: string): void {
      if (candidateHome === null) return;
      closeCandidate(repoDir, candidatePath(candidateHome, project, branch));
      if (workDir !== repoDir) workDir = repoDir;
      fenceDir = null;
    },

    changedPaths(baseSha: string, headSha: string): readonly string[] {
      return changedPaths(workDir, baseSha, headSha, fenceDir);
    },

    originUrl(): string | null {
      return originUrl(repoDir);
    },

    statusText(): string {
      return runFenced(["git", "status", "--porcelain"]).stdout.trim();
    },

    statusClean(): boolean {
      const result = runFenced(["git", "status", "--porcelain"]);
      return result.stdout.trim().length === 0;
    },

    currentBranch(): string {
      const result = runFenced(["git", "branch", "--show-current"]);
      return result.stdout.trim();
    },

    createBranch(branch: string): boolean {
      const exists = runFenced(["git", "show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).exitCode === 0;
      if (exists) {
        requireFenced(["git", "checkout", branch], `git checkout ${branch}`);
        return true;
      }
      requireFenced(["git", "checkout", "-b", branch], `git checkout -b ${branch}`);
      return false;
    },

    checkout(branch: string): void {
      requireFenced(["git", "checkout", branch], `git checkout ${branch}`);
    },

    // 129 B-7: the in-place scheduler's fast-forward needs the operator's
    // credential, so it keeps the daemon's environment and runs no hook.
    pullFfOnly(): void {
      const upstream = runProcessSync(workDir, ["git", "rev-parse", "--abbrev-ref", "@{u}"]);
      if (upstream.exitCode !== 0) return; // no upstream: nothing to be stale against
      requireOk(workDir, ["git", ...WITHOUT_REPOSITORY_HOOKS, "pull", "--ff-only"], "git pull --ff-only");
    },

    add(paths: readonly string[]): void {
      const existing = paths.filter((p) => fs.existsSync(join(workDir, p)));
      if (existing.length === 0) return;
      requireFenced(["git", "add", "--", ...existing], "git add");
    },

    // A formatting `pre-commit` still runs here (129 D-6), without a credential.
    commit(message: string): void {
      requireFenced(["git", "commit", "-m", message], "git commit");
    },

    headSha(): string {
      const result = runFenced(["git", "rev-parse", "HEAD"]);
      return result.stdout.trim();
    },

    resolveBase(defaultBranch: string): string {
      return resolveBaseSha(repoDir, defaultBranch);
    },

    // 129 B-1: the gate receives the session's environment; in place, the
    // scrub the in-place session receives (B-2, D-2).
    runGate(cmd: readonly string[]): GateResult {
      const result = runFenced(cmd);
      return {
        exitCode: result.exitCode,
        stdoutTail: tailText(result.stdout, GATE_TAIL_BYTES),
        stderrTail: tailText(result.stderr, GATE_TAIL_BYTES),
      };
    },

    readFile(path: string): string {
      try {
        return fs.readFileSync(join(workDir, path), "utf8");
      } catch (err) {
        throw new Error(`build: could not read "${path}" under ${workDir}: ${(err as Error).message}`);
      }
    },

    writeFile(path: string, content: string): void {
      try {
        fs.writeFileSync(join(workDir, path), content, "utf8");
      } catch (err) {
        throw new Error(`build: could not write "${path}" under ${workDir}: ${(err as Error).message}`);
      }
    },

    async runSession(options: RunnerSessionOptions): Promise<SessionResult> {
      // The profile is applied after the caller's options, not merged with
      // them: a stage asks for a prompt, a model, and a deadline; what the
      // session may do on the operator's machine is not a stage's to name.
      // 125 B-3: the fence rides alongside for the same reason. Which
      // credentials a session can reach is not a stage's to name either.
      return driver.runSession({
        repo: workDir,
        ...options,
        ...(fenceDir === null ? {} : { fenceDir }),
        profile: resolveProfileSource(params.profile),
      });
    },

    fenceRefusals(): number {
      return tally().refusals - spawnedRefusals;
    },

    fenceTally(): RunnerFenceTally {
      return { applied: fenceDir !== null, ...tally() };
    },
  };
}

// --- preflight refusals (B-1) -----------------------------------------------

export type RefusalKind =
  | "dirty-tree"
  | "wrong-branch"
  | "base-unresolved"
  | "candidate-unavailable"
  | "gate-red-at-base"
  | "spec-not-ready";

export interface Refusal {
  readonly kind: RefusalKind;
  readonly message: string;
}

// Injected: the daemon wires spec 012's ready() in; tests supply a trivial
// predicate. This module never imports dag.ts itself (B-1's own words:
// "readiness check injected as a predicate").
export type ReadinessCheck = (specId: string) => boolean;

// --- gate commands (B-5, reused for the B-1 "gate green at base" check) ----

// 041 B-4 supersedes 016 D-10 here. The floor itself is unchanged and stays
// 016's four spec-spine commands; it simply lives in gate-contract.ts now,
// because that is where the one derivation that consumes it lives, and it is
// re-exported from this module so every 016-era caller keeps reading it where
// 016 put it.
//
// What is gone is 016 D-10's per-target derivation. It answered "which
// language gate does this target run" by probing for a root tsconfig.json on
// every stage run, which made a Rust workspace's post-session verdict
// "governance green" and said nothing about whether the crate compiled. The
// answer is now the owning project's journaled contract (041 B-3), derived
// into a suite by gateSuiteFor(), and the two Bun commands 016 kept here
// reach this repo's own suite through this repo's own contract.
export { GATE_COMMANDS };

// The bracket's two REGENERATION commands (D-8, 119 B-1): the only writing
// spec-spine invocations in the engine. The gate floor is read-only since
// 119; only the bracket, which just changed a hashed input (the spec's
// frontmatter), rewrites derived artifacts.
export const COMPILE_REGENERATE_COMMAND: readonly string[] = ["spec-spine", "compile"];
export const INDEX_REGENERATE_COMMAND: readonly string[] = ["spec-spine", "index"];

export interface GateEvidence extends GateResult {
  readonly cmd: readonly string[];
  // 129 B-3: the refusals the supervisor counted while this command ran.
  readonly fence: FenceRecord;
}

function runnerTally(runner: Runner): RunnerFenceTally {
  return runner.fenceTally?.() ?? NO_RUNNER_FENCE;
}

// One command through the runner, with the supervisor's count read either
// side of it (129 B-3).
function runGateCommand(runner: Runner, cmd: readonly string[]): GateEvidence {
  const before = runnerTally(runner);
  const result = runner.runGate(cmd);
  const after = runnerTally(runner);
  return { cmd, ...result, fence: { applied: after.applied, refusals: after.refusals - before.refusals } };
}

interface GateSweep {
  readonly gates: GateEvidence[];
  // 129 B-3: the count immediately before and after the whole suite; the
  // difference is the gate's, and the tools are the ones it reached for.
  readonly fence: FenceRecord;
  readonly refusal: GateFenceRefusal | null;
}

function runGateSuite(runner: Runner, gate: AnyGateContract, baseSha: string): GateSweep {
  const before = runnerTally(runner);
  const gates = gateSuiteFor(gate, baseSha).map((cmd) => runGateCommand(runner, cmd));
  const after = runnerTally(runner);
  const refusals = after.refusals - before.refusals;
  return {
    gates,
    fence: { applied: after.applied, refusals },
    refusal: refusals > 0 ? { reason: GATE_FENCE_REFUSED, refusals, tools: toolsBetween(before, after) } : null,
  };
}

function describeFenceRefusal(refusal: GateFenceRefusal): string {
  const tools = refusal.tools.length === 0 ? "a fenced tool" : refusal.tools.join(" and ");
  return `${GATE_FENCE_REFUSED}: the gate reached for ${tools} and the fence refused it ${refusal.refusals} time(s)`;
}

// D-13: whether two gate sweeps are the same answer, tails included. The
// tails are what makes this a statement about the diagnostic rather than
// just the shape of the failure: two different coupling violations both
// exit 1 on the same command, and only one of them is the same wall.
function sameGateAnswer(a: readonly GateEvidence[], b: readonly GateEvidence[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((g, i) => {
    const h = b[i]!;
    return (
      g.cmd.join(" ") === h.cmd.join(" ") &&
      g.exitCode === h.exitCode &&
      g.stdoutTail === h.stdoutTail &&
      g.stderrTail === h.stderrTail &&
      g.fence.refusals === h.fence.refusals
    );
  });
}

type Preflight =
  | { refusal: Refusal; baseSha: null; reused: null; fence: FenceRecord }
  | { refusal: null; baseSha: string; reused: boolean | null; fence: FenceRecord };

// B-1's "gate green at base", which since 129 B-4 a swallowed refusal fails as
// surely as a red command.
function gateAtBaseRefusal(sweep: GateSweep, where: string): Refusal | null {
  const failing = sweep.gates.find((g) => g.exitCode !== 0);
  const reasons: string[] = [];
  if (failing) {
    reasons.push(`"${failing.cmd.join(" ")}" exited ${failing.exitCode} at ${where}: ${failing.stderrTail || failing.stdoutTail}`);
  }
  if (sweep.refusal !== null) reasons.push(`${describeFenceRefusal(sweep.refusal)} at ${where}`);
  return reasons.length === 0 ? null : { kind: "gate-red-at-base", message: reasons.join("; ") };
}

function preflightRefusal(
  runner: Runner,
  specId: string,
  defaultBranch: string,
  isSpecReady: ReadinessCheck,
  gate: AnyGateContract
): Preflight {
  // 129 B-3: the count of the last suite the preflight ran, so a refused
  // stage's evidence still carries the fence record with its explicit zero.
  let fence: FenceRecord = { applied: runnerTally(runner).applied, refusals: 0 };
  const refuse = (refusal: Refusal): Preflight => ({ refusal, baseSha: null, reused: null, fence });

  // 121 B-2: with a candidate home, the operator's checkout is read for its
  // base and its `.git` and nothing else; the candidate is what the
  // dirty-tree refusal and the gate apply to.
  if (runner.candidateHome() !== null) {
    let baseSha: string;
    try {
      baseSha = runner.resolveBase(defaultBranch);
    } catch (err) {
      return refuse({ kind: "base-unresolved", message: (err as Error).message });
    }
    let reused: boolean;
    try {
      reused = runner.openCandidate(specId, baseSha).reused;
    } catch (err) {
      return refuse({ kind: "candidate-unavailable", message: (err as Error).message });
    }
    if (!runner.statusClean()) {
      return refuse({ kind: "dirty-tree", message: `the candidate for ${specId} is not clean; refusing to start` });
    }
    const sweep = runGateSuite(runner, gate, baseSha);
    fence = sweep.fence;
    const red = gateAtBaseRefusal(sweep, "the candidate's base");
    if (red !== null) return refuse(red);
    if (!isSpecReady(specId)) {
      return refuse({ kind: "spec-not-ready", message: `${specId} is not ready (unmet or invalidated dependencies)` });
    }
    return { refusal: null, baseSha, reused, fence };
  }

  if (!runner.statusClean()) {
    return refuse({ kind: "dirty-tree", message: "the target repo's working tree is not clean; refusing to start" });
  }

  // A clean tree on some other branch is the normal aftermath of the
  // previous spec's pipeline (ship and shepherd act remotely; nothing else
  // moves the local checkout back). Normalize instead of refusing: check
  // out the default branch and fast-forward it. Only a dirty tree above, or
  // a failed normalization here, is a genuine refusal (D-7; found live when
  // spec 024's build refused on spec 023's leftover branch).
  const branch = runner.currentBranch();
  if (branch !== defaultBranch) {
    try {
      runner.checkout(defaultBranch);
      runner.pullFfOnly();
    } catch (err) {
      return refuse({
        kind: "wrong-branch",
        message: `on branch "${branch}" and could not normalize to "${defaultBranch}": ${(err as Error).message}`,
      });
    }
  } else {
    try {
      runner.pullFfOnly();
    } catch (err) {
      return refuse({
        kind: "wrong-branch",
        message: `on "${defaultBranch}" but could not fast-forward it: ${(err as Error).message}`,
      });
    }
  }

  // 119 B-2: the base is a commit, resolved once and judged against by
  // every floor this stage runs.
  let baseSha: string;
  try {
    baseSha = runner.resolveBase(defaultBranch);
  } catch (err) {
    return refuse({ kind: "base-unresolved", message: (err as Error).message });
  }

  const sweep = runGateSuite(runner, gate, baseSha);
  fence = sweep.fence;
  const red = gateAtBaseRefusal(sweep, "the base branch");
  if (red !== null) return refuse(red);

  if (!isSpecReady(specId)) {
    return refuse({ kind: "spec-not-ready", message: `${specId} is not ready (unmet or invalidated dependencies)` });
  }

  return { refusal: null, baseSha, reused: null, fence };
}

// --- frontmatter helpers (B-2, B-5) ----------------------------------------

// No YAML parser (zero-runtime-dependency convention): every spec.md in this
// corpus writes `implementation: <status>` as its own top-level line, so a
// single-line regex is the honest minimum, matching the same style journal.ts
// and dag.ts use for their own minimal parsing.
export function readImplementationStatus(specMd: string): string | null {
  const match = /^implementation:\s*(\S+)\s*$/m.exec(specMd);
  return match ? match[1]! : null;
}

export interface FlipResult {
  readonly content: string;
  readonly changed: boolean;
}

// Idempotent (FR-003): a branch reused from a crashed or even a completed
// prior attempt may already carry the flip, or the finished state. Already
// at `to`: no-op. Already `complete` while flipping toward in-progress: also
// a no-op (a fresh attempt on a branch whose work finished simply proceeds
// to evidence evaluation; the live run hit exactly this after a mid-pipeline
// daemon restart). Anything else that is not `from`: a typed error rather
// than silently overwriting an unexpected state.
export function flipImplementation(specMd: string, from: string, to: string): FlipResult {
  const current = readImplementationStatus(specMd);
  if (current === to) return { content: specMd, changed: false };
  if (current === "complete" && to === "in-progress") return { content: specMd, changed: false };
  if (current !== from) {
    throw new Error(`build: expected "implementation: ${from}" but found "implementation: ${current ?? "<missing>"}"`);
  }
  const updated = specMd.replace(/^implementation:\s*\S+\s*$/m, `implementation: ${to}`);
  return { content: updated, changed: true };
}

// Parses a simple `field:\n  - "item"\n  - item\n` frontmatter list, the
// shape every spec.md in this corpus uses for depends_on and establishes.
export function parseFrontmatterListField(specMd: string, field: string): string[] {
  const lines = specMd.split("\n");
  const fieldPattern = new RegExp(`^${field}:\\s*$`);
  const start = lines.findIndex((l) => fieldPattern.test(l));
  if (start === -1) return [];

  const items: string[] = [];
  // Requires at least one space after the dash, so the frontmatter's own
  // closing `---` delimiter (a bare run of dashes, no space) never parses as
  // a list item.
  const itemPattern = /^\s*-\s+"?([^"]+?)"?\s*$/;
  for (let i = start + 1; i < lines.length; i++) {
    const match = itemPattern.exec(lines[i]!);
    if (!match) break;
    items.push(match[1]!);
  }
  return items;
}

// --- backlog step (B-3) -----------------------------------------------------

const FALLBACK_BACKLOG_STEP =
  "Implement exactly this spec's territory, start to finish, in this one session. " +
  "Decisions the spec is silent on go in the decision drop-box, not invented silently.";

// Extracts the "## Working the backlog" section of AGENTS.md verbatim, up to
// the next top-level heading. Falls back to a built-in summary when the
// target repo's AGENTS.md is missing or reshaped, rather than failing the
// stage over prompt-assembly prose.
export function extractBacklogStep(agentsMd: string): string {
  const heading = "## Working the backlog";
  const start = agentsMd.indexOf(heading);
  if (start === -1) return FALLBACK_BACKLOG_STEP;
  const rest = agentsMd.slice(start + heading.length);
  const nextHeading = /\n## /.exec(rest);
  const section = nextHeading ? rest.slice(0, nextHeading.index) : rest;
  return section.trim();
}

function safeReadAgentsMd(runner: Runner): string {
  try {
    return runner.readFile("AGENTS.md");
  } catch {
    return "";
  }
}

// --- prompt template (B-3), kept in this module rather than a separate ----
// file: build-prompt.ts is not in spec 016's `establishes` list, and the
// template has no callers outside this stage, so a second file would only
// add a coupling surface with nothing to couple to (see Resolved decisions).

// Bumped to 2 with D-11's typed drop-box contract: the version is journaled
// with every use, so a prompt whose text changed under a frozen version
// would make `stage.build.prompt` unable to answer which text a session saw.
export const BUILD_PROMPT_VERSION = 2;

export interface BuildPromptParams {
  readonly specId: string;
  readonly specBody: string;
  readonly backlogStep: string;
  readonly decisions: DecisionsForResult;
  readonly dropboxDir: string;
  // 041 B-4 (016 D-10's intent, now contract-derived): the target's own gate
  // suite, so the prompt never promises the session a command the evaluation
  // will not run. Defaults to the governance floor alone.
  readonly gateCommands?: readonly (readonly string[])[];
}

export function buildPrompt(params: BuildPromptParams): string {
  const { specId, specBody, backlogStep, decisions, dropboxDir } = params;

  const gateList = (params.gateCommands ?? GATE_COMMANDS).map((cmd) => `  - \`${cmd.join(" ")}\``).join("\n");

  const decisionLines =
    decisions.included.length === 0
      ? "  (none recorded yet for this spec or its dependencies)"
      : decisions.included.map((d) => `  - ${d.id} (${d.specId}): ${d.title}: ${d.decision}`).join("\n");
  const overflowLine =
    decisions.overflowCount > 0
      ? `\n  (${decisions.overflowCount} older decision(s) omitted for budget; ask if you need one of them)`
      : "";

  return `You are implementing exactly one spec in this repository, start to
finish, in this one session. Build prompt template version: ${BUILD_PROMPT_VERSION}.

## Backlog protocol

${backlogStep}

## The spec to implement, verbatim

${specBody}

## Prior decisions that apply to this spec or its dependencies

${decisionLines}${overflowLine}

## The governed gate (must all exit 0 before you are done)

${gateList}

## When the coupling gate fails on a path this spec does not own

\`couple\` requires every changed path to have an authoring edit to a spec
that owns it. If your implementation must touch a unit another spec owns,
declare that in THIS spec's own frontmatter and recompile:

  extends:
    - { spec: "<the owning spec id>", unit: "<the path>", nature: additive }

That is an authoring edit to the spec you are building, which is what the
gate asks for, and it is permanent and self-documenting. Do NOT amend the
other spec to match code you just wrote: that is the coherence guard, and
it is forbidden. A \`Spec-Drift-Waiver:\` line is not available to you
either; it is read only from a PR body, which does not exist yet.

If the owning spec actually contradicts the change, \`extends\` is the wrong
answer: stop, leave the branch inspectable, and report the contradiction
for a human.

## Recording new decisions

Where this spec is silent and you must choose, write one JSON file per
decision into the decision drop-box at:

  ${dropboxDir}

Each file holds one DecisionRecord. The field types are exact and are
validated; a record that fails validation is quarantined, never sealed, so
it reaches neither the ledger nor any later session.

  id            string, unique, conventionally "<specId>-d<n>"
  specId        string, this spec's id
  scope         ARRAY of strings, never a bare string: the spec ids and/or
                repo path prefixes this decision touches
  title         string
  decision      string
  rationale     string
  alternatives  array of strings (optional)
  supersedes    string, the id of the decision this one replaces (optional)

No other fields are accepted, and no non-integer numbers anywhere. An
optional field you are not using is left out entirely; writing it as null
is accepted but says nothing. A complete example:

  {"id": "${specId}-d1",
   "specId": "${specId}",
   "scope": ["${specId}", "src/some/territory/"],
   "title": "one line naming the choice",
   "decision": "what was chosen, in full",
   "rationale": "why, and what it costs"}

Do not append to the decision ledger directly; the orchestrator seals the
drop-box after this session ends.

## House style

No em dashes (U+2014) anywhere: chat, code, comments, commit messages.
No AI attribution in commit messages or code. Match the surrounding code's
style.

Implement exactly this spec's territory, nothing more. When the gate is
green and the spec's acceptance criteria are satisfied, flip the spec's own
frontmatter to \`implementation: complete\` before finishing.
`;
}

export interface Completion {
  readonly gates: readonly GateEvidence[];
  readonly frontmatterComplete: boolean;
  readonly passing: boolean;
  // 121 B-4: whether the candidate held still across the gate (head and
  // status equal before and after, both clean). Null when no gate ran.
  readonly stable: boolean | null;
  // 121 B-5: the receipt minted for a passing, stable round, else null.
  readonly receipt: Receipt | null;
  // 129 B-3: the supervisor's count across the suite, with its explicit zero.
  readonly fence: FenceRecord;
  // 129 B-4: set when that count rose, whatever the commands exited; such a
  // round is not accepted and mints no receipt.
  readonly fenceRefusal: GateFenceRefusal | null;
}

export interface EvaluateParams {
  readonly runner: Runner;
  readonly specId: string;
  readonly specPath: string;
  readonly gate: AnyGateContract;
  readonly baseSha: string;
  readonly branch: string;
  readonly round: number;
  readonly journal: JournalHandle;
  readonly profile: ProfileSource | undefined;
}

// 121 B-4, B-5: the gate over a stable candidate, and the receipt when it
// passes. Head and status are read before and after the suite; a candidate
// that moved or dirtied across it is journaled `acceptance.unstable` and the
// round does not pass, whatever the commands said.
//
// 129 B-4: likewise a suite during which the supervisor's count rose. The exit
// code cannot be the rule, because a gate can swallow it (`gh pr create ||
// true` exits 0 with the refusal counted), so the refusal is journaled as
// `acceptance.fence-refused` and the round does not pass, whatever the
// commands said. Every round reaches the gate through here (build rounds 1
// and 2, ship's round 3, shepherd's round 4), so the rule is one rule.
export function evaluateCompletion(p: EvaluateParams): Completion {
  const { runner, specId, specPath, gate, baseSha, round, journal } = p;
  const headBefore = runner.headSha();
  const dirtyBefore = runner.statusText();
  const sweep = runGateSuite(runner, gate, baseSha);
  const { gates, fence, refusal: fenceRefusal } = sweep;
  const headAfter = runner.headSha();
  const dirtyAfter = runner.statusText();
  const allGreen = gates.every((g) => g.exitCode === 0);
  const frontmatterComplete = readImplementationStatus(runner.readFile(specPath)) === "complete";
  const stable = headBefore === headAfter && dirtyBefore.length === 0 && dirtyAfter.length === 0;
  if (fenceRefusal !== null) {
    journal.append(FENCE_REFUSED_KIND, {
      specId,
      round,
      reason: fenceRefusal.reason,
      refusals: fenceRefusal.refusals,
      tools: [...fenceRefusal.tools],
    });
  }
  if (!stable) {
    const payload: Record<string, JsonValue> = {
      specId,
      round,
      headBefore,
      headAfter,
      dirty: dirtyAfter.length > 0 ? dirtyAfter : dirtyBefore,
    };
    journal.append(UNSTABLE_KIND, payload);
    return { gates, frontmatterComplete, passing: false, stable, receipt: null, fence, fenceRefusal };
  }
  const passing = allGreen && frontmatterComplete && fenceRefusal === null;
  if (!passing) return { gates, frontmatterComplete, passing, stable, receipt: null, fence, fenceRefusal };
  const version = runner.runGate(["spec-spine", "--version"]);
  const receipt = mintReceipt({
    specId,
    round,
    origin: runner.originUrl(),
    baseSha,
    candidateSha: headAfter,
    branch: p.branch,
    suite: gates.map((g) => g.cmd),
    gate: gatePayload(gate),
    profile: profilePayload(resolveProfileSource(p.profile)),
    specSpineVersion: version.exitCode === 0 ? version.stdoutTail.trim() : null,
    results: gates.map((g) => ({ cmd: g.cmd, exitCode: g.exitCode })),
    changedPaths: runner.changedPaths(baseSha, headAfter),
  });
  journal.append(RECEIPT_KIND, receiptPayload(receipt));
  if (receipt.sensitivePaths.length > 0) {
    journal.append(SENSITIVE_KIND, { specId, round, paths: [...receipt.sensitivePaths] });
  }
  return { gates, frontmatterComplete, passing, stable, receipt, fence, fenceRefusal };
}

// 129 B-4: what the remediation session is told when the gate reached for a
// fenced tool. The shim's own message is quoted because a gate that swallowed
// the exit code may well have swallowed the message with it.
function fenceRefusalSection(refusal: GateFenceRefusal | null): string {
  if (refusal === null) return "";
  const tools: readonly FencedTool[] = refusal.tools.length === 0 ? ["gh", "ssh"] : refusal.tools;
  const messages = tools.map((tool) => `  ${FENCE_MESSAGES[tool]}`).join("\n");
  return `
### The gate reached for a fenced tool (${GATE_FENCE_REFUSED})

While the gate suite ran, the credential fence refused ${refusal.refusals} time(s)
(${refusal.tools.length === 0 ? "a fenced tool" : refusal.tools.map((t) => `\`${t}\``).join(" and ")}), so the round is not
accepted whatever the commands exited. The fence said:

${messages}

A test, a Makefile target or a build script that publishes, or that probes
for a tool by running it, must change: publishing goes through the broker.
`;
}

function remediationPrompt(basePrompt: string, completion: Completion, capsule: string = ""): string {
  const failingGates = completion.gates.filter((g) => g.exitCode !== 0);
  const gateSection =
    failingGates.length === 0
      ? "(every gate command passed)"
      : failingGates
          .map(
            (g) =>
              `### \`${g.cmd.join(" ")}\` (exit ${g.exitCode})\n\nstdout tail:\n${g.stdoutTail}\n\nstderr tail:\n${g.stderrTail}`
          )
          .join("\n\n");
  const frontmatterNote = completion.frontmatterComplete
    ? ""
    : '\nThe spec\'s own frontmatter still does not read "implementation: complete". Flip it once the work is actually done.\n';

  return `${basePrompt}
## Remediation: the gate was red after your last session

This is a second, follow-up session on the same branch, the last one before
the build stage fails honestly. Fix the following, then finish:
${frontmatterNote}
${gateSection}
${fenceRefusalSection(completion.fenceRefusal)}
${capsule}`;
}

// --- evidence and outcome (FR-002) ------------------------------------------

export type StageOutcome = "passed" | "failed" | "refused" | "blocked";

export interface SessionEvidence {
  readonly sessionId: string | null;
  readonly classification: string;
  readonly costMicroUsd: number | null;
  readonly numTurns: number | null;
  readonly durationMs: number;
  // 119 B-6: the refusals the harness reported, independent of the
  // classification (doc 04 D41). Zero for a synthesized result.
  readonly denials: number;
  // 125 B-7: how many times the credential fence refused during this round.
  // Zero in the in-place mode, which has no fence (121 D-5).
  readonly fenceRefusals: number;
}

export interface BuildEvidence {
  readonly specId: string;
  readonly branch: string | null;
  readonly headSha: string | null;
  readonly promptVersion: number | null;
  readonly refusal: Refusal | null;
  readonly sessions: readonly SessionEvidence[];
  readonly gates: readonly GateEvidence[];
  readonly frontmatterComplete: boolean | null;
  readonly decisions: SealDropboxResult | null;
  // 121 B-5, B-7: the receipt the passing round minted, and the
  // policy-sensitive paths it names. Null and empty when no receipt.
  readonly receipt: Receipt | null;
  readonly sensitivePaths: readonly string[];
  // D-13: true when the remediation session left the branch head untouched
  // and the gate answered identically, so another attempt would re-ask a
  // question already answered twice. Null when no remediation session ran.
  readonly stalled: boolean | null;
  // 129 B-3: the fence record of the last gate suite the stage ran, with its
  // explicit zero; the session counts above no longer include it.
  readonly gateFence: FenceRecord;
  // 129 B-4: why that suite was not accepted though its commands may have
  // exited 0. Null when the count did not rise.
  readonly fenceRefusal: GateFenceRefusal | null;
}

export interface BuildResult {
  readonly outcome: StageOutcome;
  readonly evidence: BuildEvidence;
}

function toSessionEvidence(result: SessionResult, fenceRefusals: number): SessionEvidence {
  return {
    sessionId: result.sessionId,
    classification: result.classification.kind,
    costMicroUsd: result.costMicroUsd,
    numTurns: result.numTurns,
    durationMs: result.durationMs,
    denials: result.denials,
    fenceRefusals,
  };
}

// 119 B-7: a session that completed with refusals leaves them in the
// evidence before completion is evaluated (doc 04 D41). The hook-blocked
// short-circuit above is unchanged; this is the case it does not cover, a
// harness that refused and then finished.
function journalDenials(journal: JournalHandle, specId: string, round: number, result: SessionResult): void {
  if (result.denials === 0) return;
  const payload: Record<string, JsonValue> = {
    specId,
    round,
    sessionId: result.sessionId,
    denials: result.denials,
    samples: [...result.denialSamples],
  };
  journal.append("stage.build.denials", payload);
}

// 125 B-7: a session that reached for `gh` or `ssh` tried to publish around
// the broker, and the journal is the only place that fact survives. It does
// not refuse the round: the session may well have finished its actual work.
// It is the signal that a prompt still asks for what the boundary forbids.
function journalFenceRefusals(
  journal: JournalHandle,
  specId: string,
  round: number,
  sessionId: string | null,
  count: number
): void {
  if (count === 0) return;
  journal.append("fence.refused", { specId, round, sessionId, refusals: count });
}

function gateEvidenceToJson(g: GateEvidence): Record<string, JsonValue> {
  return {
    cmd: [...g.cmd],
    exitCode: g.exitCode,
    stdoutTail: g.stdoutTail,
    stderrTail: g.stderrTail,
    fence: { applied: g.fence.applied, refusals: g.fence.refusals },
  };
}

function fenceToJson(fence: FenceRecord): Record<string, JsonValue> {
  return { applied: fence.applied, refusals: fence.refusals };
}

// --- defaults (B-4) ----------------------------------------------------------

export const DEFAULT_BASE_BRANCH = "main";
export const DEFAULT_BUILD_DEADLINE_MS = 45 * 60_000;
// 160, not 80: two consecutive spec-sized builds (032, 033) each ran their
// session and their remediation session into the 80-turn cap while sitting
// one fix short of green (016 D-9). The deadline still bounds wall clock and
// spec 033's ceilings bound spend, so the turn cap no longer has to do the
// money's job badly.
export const DEFAULT_BUILD_MAX_TURNS = 160;
export const DECISION_BUDGET_CHARS = 20_000;

// --- the stage (B-1 through B-6) --------------------------------------------

export interface RunBuildStageOptions {
  readonly runner: Runner;
  readonly specId: string;
  readonly journal: JournalHandle;
  readonly decisionsChain: JournalHandle;
  readonly dropboxDir: string;
  readonly knownSpecIds: ReadonlySet<string>;
  readonly isSpecReady: ReadinessCheck;
  readonly defaultBranch?: string;
  readonly deadlineMs?: number;
  readonly maxTurns?: number;
  readonly tier?: ModelTier;
  readonly model?: string;
  // 041 B-4: the owning project's gate contract, or a late-bound read of it.
  // Absent is 041 B-3's legacy fold, which runs the spec-spine floor and
  // nothing else, and is what a fixture world that never registered a project
  // is honestly judged by.
  readonly gate?: GateBinding;
  // 121 B-5: the owning project's posture, folded into the receipt's policy
  // digest. Absent is 032 D-1's default, as the runner's own spawn reads it.
  readonly profile?: ProfileSource;
  // 123 B-6: what the capsule names the project, and the ceiling its
  // allowance is measured against.
  readonly projectName?: string;
  readonly ceiling?: CostCeiling | null;
}

export async function runBuildStage(options: RunBuildStageOptions): Promise<BuildResult> {
  const { runner, specId, journal, decisionsChain, dropboxDir, knownSpecIds, isSpecReady } = options;
  const defaultBranch = options.defaultBranch ?? DEFAULT_BASE_BRANCH;
  // Resolved once per stage run rather than per gate sweep: a stage must be
  // judged at the end by the same list it was preflighted against, or the
  // "gate green at base" evidence is about a different gate than the verdict.
  const gate = resolveGateBinding(options.gate);
  const timeoutMs = options.deadlineMs ?? DEFAULT_BUILD_DEADLINE_MS;
  const maxTurns = options.maxTurns ?? DEFAULT_BUILD_MAX_TURNS;
  const specPath = `specs/${specId}/spec.md`;

  // --- B-1: preflight refusals ---
  const preflight = preflightRefusal(runner, specId, defaultBranch, isSpecReady, gate);
  if (preflight.refusal) {
    const refusal = preflight.refusal;
    const payload: Record<string, JsonValue> = { specId, kind: refusal.kind, message: refusal.message };
    journal.append("stage.build.refused", payload);
    return {
      outcome: "refused",
      evidence: {
        specId,
        branch: null,
        headSha: null,
        promptVersion: null,
        refusal,
        sessions: [],
        gates: [],
        frontmatterComplete: null,
        decisions: null,
        receipt: null,
        sensitivePaths: [],
        stalled: null,
        gateFence: preflight.fence,
        fenceRefusal: null,
      },
    };
  }

  const baseSha = preflight.baseSha;

  // --- B-2: orchestrator-owned bracket ---
  const branch = specId;
  // 121 B-1: with a candidate, the branch was opened by the preflight; in
  // place, it is created or reused here as 016 B-2 did.
  const reused = preflight.reused ?? runner.createBranch(branch);

  const beforeContent = runner.readFile(specPath);
  const flip = flipImplementation(beforeContent, "pending", "in-progress");
  let bracketGate: GateEvidence | null = null;
  let bracketIndex: GateEvidence | null = null;
  if (flip.changed) {
    runner.writeFile(specPath, flip.content);
    // 129 B-1: the bracket reaches the repository through runGate, fenced.
    bracketGate = runGateCommand(runner, COMPILE_REGENERATE_COMMAND);
    // D-8: the flip touches the codebase-index shards too, so the bracket
    // regenerates them before its commit. A flip commit carrying the
    // pre-flip shard is absorbed by the session's final commit on the happy
    // path, but an early crash leaves the next `spec-spine index` run to
    // dirty the tree, which is exactly what makes 021 D-17's normalization
    // refuse to act.
    if (bracketGate.exitCode === 0) {
      bracketIndex = runGateCommand(runner, INDEX_REGENERATE_COMMAND);
    }
    runner.add([specPath, ".derived"]);
    runner.commit(`chore(${specId}): flip implementation to in-progress`);
  }
  const bracketHeadSha = runner.headSha();

  const bracketPayload: Record<string, JsonValue> = {
    specId,
    branch,
    reused,
    flipped: flip.changed,
    headSha: bracketHeadSha,
    baseSha,
    compileExitCode: bracketGate?.exitCode ?? null,
    indexExitCode: bracketIndex?.exitCode ?? null,
  };
  journal.append("stage.build.bracket", bracketPayload);

  const bracketEvidence = [bracketGate, bracketIndex].filter((g): g is GateEvidence => g !== null);
  if (bracketEvidence.some((g) => g.exitCode !== 0)) {
    const resultPayload: Record<string, JsonValue> = { specId, outcome: "failed", branch, headSha: bracketHeadSha };
    journal.append("stage.build.result", resultPayload);
    return {
      outcome: "failed",
      evidence: {
        specId,
        branch,
        headSha: bracketHeadSha,
        promptVersion: null,
        refusal: null,
        sessions: [],
        gates: bracketEvidence,
        frontmatterComplete: false,
        decisions: null,
        receipt: null,
        sensitivePaths: [],
        stalled: null,
        gateFence: {
          applied: runnerTally(runner).applied,
          refusals: bracketEvidence.reduce((sum, g) => sum + g.fence.refusals, 0),
        },
        fenceRefusal: null,
      },
    };
  }

  // --- B-3: prompt assembly ---
  const specBody = flip.content;
  const backlogStep = extractBacklogStep(safeReadAgentsMd(runner));
  const dependsOnClosure = parseFrontmatterListField(specBody, "depends_on");
  const territoryPaths = parseFrontmatterListField(specBody, "establishes");
  const chainRecords = decisionRecordsFromChain(decisionsChain.fold());
  const decisionSelection = decisionsFor({
    records: chainRecords,
    specId,
    dependsOnClosure,
    territoryPaths,
    budgetChars: DECISION_BUDGET_CHARS,
  });
  const promptBase = buildPrompt({
    specId,
    specBody,
    backlogStep,
    decisions: decisionSelection,
    dropboxDir,
    gateCommands: gateSuiteFor(gate),
  });

  const promptPayload: Record<string, JsonValue> = {
    specId,
    promptVersion: BUILD_PROMPT_VERSION,
    decisionsIncluded: decisionSelection.included.map((d) => d.id),
    decisionsOverflow: decisionSelection.overflowCount,
  };
  journal.append("stage.build.prompt", promptPayload);

  // --- B-4: drive (one session, at most one remediation) ---
  const sessions: SessionEvidence[] = [];

  // 129 B-3: each session's count is the supervisor's difference across that
  // session alone, so neither the preflight's gate nor a later round's is in it.
  const firstStart = runner.fenceRefusals?.() ?? 0;
  const first = await runner.runSession({ prompt: promptBase, timeoutMs, maxTurns, tier: options.tier, model: options.model, journal });
  const firstFence = (runner.fenceRefusals?.() ?? 0) - firstStart;
  sessions.push(toSessionEvidence(first, firstFence));
  journalDenials(journal, specId, 1, first);
  journalFenceRefusals(journal, specId, 1, first.sessionId, firstFence);

  const evaluate = (round: number): Completion =>
    evaluateCompletion({ runner, specId, specPath, gate, baseSha, branch, round, journal, profile: options.profile });

  let blocked = first.classification.kind === "hook-blocked";
  let completion: Completion = blocked
    ? {
        gates: [],
        frontmatterComplete: false,
        passing: false,
        stable: null,
        receipt: null,
        fence: { applied: runnerTally(runner).applied, refusals: 0 },
        fenceRefusal: null,
      }
    : evaluate(1);

  if (!blocked) {
    const gateRecord: Record<string, JsonValue> = {
      specId,
      round: 1,
      baseSha,
      gates: completion.gates.map(gateEvidenceToJson),
      frontmatterComplete: completion.frontmatterComplete,
      fence: fenceToJson(completion.fence),
      reason: completion.fenceRefusal?.reason ?? null,
    };
    journal.append("stage.build.gate", gateRecord);
  }

  // D-13: what the remediation session was given, and what it changed, so a
  // stage that cannot move can say so instead of being retried blind.
  let stalled: boolean | null = null;

  if (!blocked && !completion.passing) {
    const beforeSha = runner.headSha();
    const beforeGates = completion.gates;

    // 123 B-6: the capsule rides into the remediation prompt, so a session
    // in either harness starts from the same record.
    const capsule = renderCapsule(
      buildCapsule({
        records: journal.fold().records,
        decisions: decisionsChain.fold().records,
        specId,
        project: { name: options.projectName ?? basename(runner.workDir()), origin: runner.originUrl() },
        ceiling: options.ceiling ?? null,
      })
    );
    const secondPrompt = remediationPrompt(promptBase, completion, capsule);
    const secondStart = runner.fenceRefusals?.() ?? 0;
    const second = await runner.runSession({
      prompt: secondPrompt,
      timeoutMs,
      maxTurns,
      tier: options.tier,
      model: options.model,
      journal,
    });
    const secondFence = (runner.fenceRefusals?.() ?? 0) - secondStart;
    sessions.push(toSessionEvidence(second, secondFence));
    journalDenials(journal, specId, 2, second);
    journalFenceRefusals(journal, specId, 2, second.sessionId, secondFence);

    blocked = second.classification.kind === "hook-blocked";
    if (!blocked) {
      completion = evaluate(2);
      stalled = !completion.passing && runner.headSha() === beforeSha && sameGateAnswer(beforeGates, completion.gates);
      const gateRecord: Record<string, JsonValue> = {
        specId,
        round: 2,
        baseSha,
        gates: completion.gates.map(gateEvidenceToJson),
        frontmatterComplete: completion.frontmatterComplete,
        fence: fenceToJson(completion.fence),
        reason: completion.fenceRefusal?.reason ?? null,
      };
      journal.append("stage.build.gate", gateRecord);
    }
  }

  // --- B-6: decision capture ---
  const sealResult = sealDropbox({ dropboxDir, chain: decisionsChain, knownSpecIds, journal });

  const headSha = runner.headSha();
  const outcome: StageOutcome = blocked ? "blocked" : completion.passing ? "passed" : "failed";

  const evidence: BuildEvidence = {
    specId,
    branch,
    headSha,
    promptVersion: BUILD_PROMPT_VERSION,
    refusal: null,
    sessions,
    gates: completion.gates,
    frontmatterComplete: completion.frontmatterComplete,
    decisions: sealResult,
    receipt: completion.receipt,
    sensitivePaths: completion.receipt?.sensitivePaths ?? [],
    stalled,
    gateFence: completion.fence,
    fenceRefusal: completion.fenceRefusal,
  };

  const resultPayload: Record<string, JsonValue> = {
    specId,
    outcome,
    branch,
    headSha,
    gateExitCodes: completion.gates.map((g) => g.exitCode),
    sessionIds: sessions.map((s) => s.sessionId),
    decisionsSealed: sealResult.sealed.map((d) => d.id),
    decisionsInvalid: sealResult.invalid.map((i) => i.file),
    stalled,
    denials: sessions.reduce((sum, s) => sum + s.denials, 0),
    stable: completion.stable,
    receipt: completion.receipt !== null,
    sensitivePaths: completion.receipt === null ? [] : [...completion.receipt.sensitivePaths],
    gateFence: fenceToJson(completion.fence),
    reason: completion.fenceRefusal?.reason ?? null,
  };
  journal.append("stage.build.result", resultPayload);

  return { outcome, evidence };
}
