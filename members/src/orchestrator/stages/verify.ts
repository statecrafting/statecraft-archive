// The verify stage (spec 019): the fourth pipeline stage, and the
// re-qualification path for invalidated specs (spec 012 B-4). A spec MAY
// declare observable behavior in a `## Verification` section (B-1):
// `verify:cli` fenced blocks (shell commands, one per line, comments with
// `#` allowed) and `verify:browser` fenced blocks (a `url:` first line, then
// one natural-language assertion per line). The parser is pure and typed
// (FR-001): a spec with no such section parses to `{declared: false}`; a
// malformed block (an unknown `verify:*` tag, a browser block with no url
// line, or an empty block) is a parse error, never silently skipped or
// dropped.
//
// CLI assertions (B-2) run serially, one shell command at a time, each with
// its own timeout, inside a clean `git worktree` checked out at the merged
// sha, never the caller's own working tree (which may be dirty, mid-flight,
// or simply on a different branch). The worktree is created before anything
// else runs and removed again once the stage is done, pass or fail. Browser
// assertions (B-3, D-10) run behind a BrowserVerifier seam; the production
// implementation drives a fresh claude session per assertion, handing it a
// headless browser MCP server it declares itself (Playwright MCP via bunx,
// strict `--mcp-config`, spec 014 D-10) and requiring a strict JSON reply,
// and is never constructed by this file's own
// tests (FR-002: unit tests use a fake BrowserVerifier only, mirroring
// spec 014's and spec 017's own "never spawn the real claude/gh in tests"
// convention; the live path is excluded from CI the same way spec 014's own
// AC-2 live smoke session is, run manually rather than checked in).
//
// Every assertion's evidence (a cli command's bounded stdout+stderr; a
// browser assertion's verdict detail and, when the verifier returns one, a
// screenshot) is written to a content-addressed file (sha256 name) under
// the caller's evidenceDir; the journal only ever references {assertion,
// evidenceHash}, never inline content (FR-003).
//
// Spec 129 B-8 to B-10: the acceptance a merge is verified by is the one the
// run was judged against, read at the base revision, so the session being
// judged cannot rewrite it; each acceptance line runs behind a fence built
// beside the verify worktree, and a refusal fails the stage whatever the line
// exited. A project whose acceptance is live by design has an operator's
// journaled allowance (B-9), never a spec's say-so.
import * as fs from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID, createHash } from "crypto";
import type { JournalHandle, JournalRecord, JsonValue } from "../journal";
import { createProcessDriver, type Driver } from "../driver";
import { tierForStage } from "../models";
import { resolveProfileSource, type ProfileSource } from "../profile";
import { fencedEnv, WITHOUT_REPOSITORY_HOOKS } from "../candidate";
import { buildFence, NO_FENCE_TALLY, openFenceChannel, toolsBetween, type FenceChannel, type FenceTally } from "../fence";
import { parseReceipt, RECEIPT_KIND } from "../receipt";
import type { VerifyAllowance } from "../projects";

// --- Verification-section parser (B-1, FR-001) ------------------------------

export interface CliBlock {
  readonly blockIndex: number;
  readonly commands: readonly string[];
}

export interface BrowserBlock {
  readonly blockIndex: number;
  readonly url: string;
  readonly assertions: readonly string[];
}

export type ParseVerificationResult =
  | { readonly declared: false }
  | { readonly declared: true; readonly cli: readonly CliBlock[]; readonly browser: readonly BrowserBlock[] }
  | { readonly declared: "error"; readonly message: string };

const VERIFICATION_HEADING_RE = /^## Verification\s*$/m;
const NEXT_HEADING_RE = /^## /m;
// Matches a fenced code block whose opening line is ```<tag> and whose
// closing line is a bare ``` starting a line of its own; the body (possibly
// empty) is captured non-greedily so an immediately-closed fence (no body
// line at all) still matches rather than being silently skipped.
const FENCE_RE = /^```([^\n`]*)\r?\n([\s\S]*?)^```[ \t]*\r?$/gm;
const URL_LINE_RE = /^url:\s*(\S+)\s*$/i;

export function extractVerificationSection(specBody: string): string | null {
  const heading = VERIFICATION_HEADING_RE.exec(specBody);
  if (!heading) return null;
  const rest = specBody.slice(heading.index + heading[0].length);
  const next = NEXT_HEADING_RE.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

type BlockParse<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

function parseCliBlockBody(body: string): BlockParse<{ commands: string[] }> {
  const commands: string[] = [];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.startsWith("#")) continue;
    commands.push(line);
  }
  if (commands.length === 0) {
    return { ok: false, error: "empty verify:cli block (no commands after stripping comments and blank lines)" };
  }
  return { ok: true, value: { commands } };
}

function parseBrowserBlockBody(body: string): BlockParse<{ url: string; assertions: string[] }> {
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { ok: false, error: "empty verify:browser block" };

  const urlMatch = URL_LINE_RE.exec(lines[0]!);
  if (!urlMatch) {
    return { ok: false, error: `verify:browser block without a "url: <url>" first line (found "${lines[0]}")` };
  }

  const assertions = lines.slice(1);
  if (assertions.length === 0) return { ok: false, error: "empty verify:browser block (a url but no assertions)" };
  return { ok: true, value: { url: urlMatch[1]!, assertions } };
}

// Pure (FR-001). No Verification section at all is honestly `not-declared`,
// never guessed at; a malformed block anywhere in the section fails the
// whole parse (every malformed block is collected into the one message,
// never just the first, so nothing is silently skipped).
export function parseVerificationSection(specBody: string): ParseVerificationResult {
  const section = extractVerificationSection(specBody);
  if (section === null) return { declared: false };

  const cli: CliBlock[] = [];
  const browser: BrowserBlock[] = [];
  const errors: string[] = [];

  FENCE_RE.lastIndex = 0;
  let fenceOrdinal = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCE_RE.exec(section)) !== null) {
    fenceOrdinal++;
    const tag = match[1]!.trim();
    const body = match[2]!;
    if (!tag.startsWith("verify:")) continue; // an unrelated fence (e.g. a plain example snippet): not this section's business

    const kind = tag.slice("verify:".length).trim();
    if (kind === "cli") {
      const parsed = parseCliBlockBody(body);
      if (parsed.ok) cli.push({ blockIndex: cli.length, commands: parsed.value.commands });
      else errors.push(`fenced block ${fenceOrdinal} (${tag}): ${parsed.error}`);
    } else if (kind === "browser") {
      const parsed = parseBrowserBlockBody(body);
      if (parsed.ok) browser.push({ blockIndex: browser.length, url: parsed.value.url, assertions: parsed.value.assertions });
      else errors.push(`fenced block ${fenceOrdinal} (${tag}): ${parsed.error}`);
    } else {
      errors.push(`fenced block ${fenceOrdinal}: unknown verification tag "${tag}" (expected verify:cli or verify:browser)`);
    }
  }

  if (errors.length > 0) return { declared: "error", message: errors.join("; ") };
  return { declared: true, cli, browser };
}

// --- evidence (FR-003: content-addressed, journal references only) --------

function sha256HexBuffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function tailText(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= maxBytes) return text;
  return new TextDecoder().decode(bytes.subarray(bytes.length - maxBytes));
}

// Writes `buf` under `evidenceDir` named by its own sha256 hash; a second
// assertion whose output hashes identically reuses the same file rather
// than writing a duplicate. Returns the hash, the only thing the journal
// ever carries (FR-003: never inline content).
function writeEvidenceFile(evidenceDir: string, buf: Buffer, ext: string): string {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const hash = sha256HexBuffer(buf);
  const filePath = join(evidenceDir, `${hash}${ext}`);
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, buf);
  return hash;
}

function writeTextEvidence(evidenceDir: string, text: string, maxBytes: number): string {
  return writeEvidenceFile(evidenceDir, Buffer.from(tailText(text, maxBytes), "utf8"), ".txt");
}

export const DEFAULT_EVIDENCE_TEXT_BYTES = 16 * 1024;

// --- VerifyRunner seam (B-2): worktree lifecycle + bounded command exec ----
//
// A new seam rather than an extension of build.ts's own Runner (spec 016):
// that interface's `runGate` always runs in one fixed repoDir with no
// per-call timeout, but B-2 needs commands to run inside a just-created
// worktree directory (never the fixed repoDir) with a per-command deadline.
// The shape still follows the family convention build.ts established
// (interface + a Bun.spawnSync-backed production factory + scripted fakes
// in tests), just for a genuinely different set of operations (see this
// spec's Resolved decisions).

export interface CliRunResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly durationMs: number;
}

export interface VerifyRunner {
  // Creates `git worktree add --detach <tmp> <sha>` against the target repo
  // and returns the absolute path to the new worktree.
  addWorktree(sha: string): string;
  // Removes the worktree created by addWorktree, including a filesystem
  // fallback and a `git worktree prune`, so a partial or already-gone
  // worktree never leaves stray registrations or files behind.
  removeWorktree(path: string): void;
  // Runs `cmd` with the given cwd (always the worktree, never the target
  // repo's own working tree) and a hard timeout. 129 B-8, B-9: `fenced` (the
  // default) runs it inside the fence built beside that worktree; `inherit`,
  // an operator's journaled allowance, runs it with the daemon's environment.
  runCommand(cwd: string, cmd: readonly string[], timeoutMs: number, allowance?: VerifyAllowance): CliRunResult;
  // Reads a file at an absolute path (used to read spec.md out of the
  // worktree once it exists); verify never writes back into the target
  // repo or its worktree.
  readFile(path: string): string;
  // 129 B-8: a repository-relative file as it stood at a revision, or null
  // when it did not exist there or cannot be read. Optional so a fixture
  // runner that never reaches a verification section need not grow it.
  readFileAtRevision?(sha: string, path: string): string | null;
  // 129 B-8: the fence built beside a worktree this runner added, or null.
  fenceFor?(worktreePath: string): string | null;
  // 129 B-3: the supervisor's count of the refusals this runner's fences
  // reported. The stage reads it either side of each line.
  fenceTally?(): FenceTally;
}

export interface CreateProcessVerifyRunnerParams {
  readonly repoDir: string;
  // 129 B-8: the daemon home the verify worktree and its fence are built
  // under, side by side, and removed with. Absent is the system temporary
  // directory, which is what a runner built outside a daemon has.
  readonly homeDir?: string;
}

export function createProcessVerifyRunner(params: CreateProcessVerifyRunnerParams): VerifyRunner {
  const { repoDir } = params;
  // 129 B-3: the verify stage is the supervisor of its acceptance lines, so it
  // holds a channel of its own, for the runner's life. Every worktree's fence
  // shares it and each addWorktree resets it, which assumes one verify at a
  // time per runner: the daemon drains its re-verify queue one spec at a time.
  // A caller that opened two worktrees at once would need a channel each.
  let channel: FenceChannel | null = null;
  const fences = new Map<string, { root: string; fence: string }>();

  return {
    addWorktree(sha: string): string {
      // Shepherd merges remotely; the merge sha may not exist locally until
      // fetched (the live run failed on exactly this: invalid reference).
      const known = Bun.spawnSync(["git", "rev-parse", "--verify", `${sha}^{commit}`], { cwd: repoDir });
      if (known.exitCode !== 0) {
        // 129 B-7: the fetch keeps the daemon's credential and runs no hook.
        const fetch = Bun.spawnSync(["git", ...WITHOUT_REPOSITORY_HOOKS, "fetch", "origin"], { cwd: repoDir });
        if (fetch.exitCode !== 0) {
          throw new Error(`verify: git fetch origin failed: ${new TextDecoder().decode(fetch.stderr).trim()}`);
        }
      }
      // 129 B-8: the worktree and its fence side by side under one root, the
      // fence never inside the tree it guards, and both removed together.
      const id = randomUUID();
      const root = params.homeDir === undefined ? join(tmpdir(), `verify-${id}`) : join(params.homeDir, "verify", id);
      const target = join(root, "worktree");
      fs.mkdirSync(root, { recursive: true });
      channel ??= openFenceChannel();
      const fence = buildFence(join(root, "fence"), { channel });
      // 129 B-6's rule for a checkout the engine makes: `post-checkout` is the
      // repository's code, so the worktree is added inside the fence.
      const result = Bun.spawnSync(["git", "worktree", "add", "--detach", target, sha], { cwd: repoDir, env: fencedEnv(fence) });
      if (result.exitCode !== 0) {
        fs.rmSync(root, { recursive: true, force: true });
        throw new Error(
          `verify: git worktree add ${target} ${sha} failed: ${new TextDecoder().decode(result.stderr).trim()}`
        );
      }
      fences.set(target, { root, fence });
      return target;
    },

    removeWorktree(path: string): void {
      Bun.spawnSync(["git", "worktree", "remove", "--force", path], { cwd: repoDir });
      const layout = fences.get(path);
      try {
        fs.rmSync(layout === undefined ? path : layout.root, { recursive: true, force: true });
      } catch {
        // already gone
      }
      fences.delete(path);
      Bun.spawnSync(["git", "worktree", "prune"], { cwd: repoDir });
    },

    runCommand(cwd: string, cmd: readonly string[], timeoutMs: number, allowance: VerifyAllowance = "fenced"): CliRunResult {
      const startedAtMs = Date.now();
      // `inherit` is the daemon's own environment, passed as it stands now
      // (Bun's default is the environment the process started with); a cwd
      // this runner did not add has no fence and receives the scrub.
      const env = allowance === "inherit" ? process.env : fencedEnv(fences.get(cwd)?.fence ?? null);
      const result = Bun.spawnSync(cmd as string[], { cwd, env, timeout: timeoutMs, killSignal: "SIGKILL" });
      return {
        exitCode: result.exitedDueToTimeout ? null : result.exitCode,
        stdout: new TextDecoder().decode(result.stdout),
        stderr: new TextDecoder().decode(result.stderr),
        timedOut: Boolean(result.exitedDueToTimeout),
        durationMs: Date.now() - startedAtMs,
      };
    },

    readFile(path: string): string {
      try {
        return fs.readFileSync(path, "utf8");
      } catch (err) {
        throw new Error(`verify: could not read "${path}": ${(err as Error).message}`);
      }
    },

    // A blob read: `git show <rev>:<path>` runs no hook and no filter.
    readFileAtRevision(sha: string, path: string): string | null {
      const result = Bun.spawnSync(["git", "show", `${sha}:${path}`], { cwd: repoDir });
      return result.exitCode === 0 ? new TextDecoder().decode(result.stdout) : null;
    },

    fenceFor(worktreePath: string): string | null {
      return fences.get(worktreePath)?.fence ?? null;
    },

    fenceTally(): FenceTally {
      return channel === null ? NO_FENCE_TALLY : channel.tally();
    },
  };
}

// --- BrowserVerifier seam (B-3, FR-002) -------------------------------------

export interface BrowserAssertResult {
  readonly pass: boolean;
  readonly detail: string;
  readonly screenshotPngBase64?: string;
}

// 129 B-10: where an assertion session runs. The verify worktree rather than
// the operator's checkout, and the fence built beside it, passed to the driver
// the way the build passes its session's (125 B-3); null under an operator's
// `inherit` allowance, when the session receives the scrub alone.
export interface BrowserAssertContext {
  readonly cwd: string;
  readonly fenceDir: string | null;
}

export interface BrowserVerifier {
  assert(url: string, assertion: string, context?: BrowserAssertContext): Promise<BrowserAssertResult>;
}

// A remediation-shaped quota signal (mirroring shepherd's own StatuslessAbortError
// pattern, spec 018): the BrowserVerifier interface's happy path only ever
// returns pass/detail/screenshot, so a session that classifies `quota`
// (spec 014) is surfaced as a typed throw instead, letting runVerifyStage
// map it to outcome "quota" without inventing a fourth field on the
// interface's return shape (Resolved decisions).
export class BrowserVerifierQuotaError extends Error {
  readonly resetAtMs: number | null;
  constructor(detail: string, resetAtMs: number | null) {
    super(`verify: browser assertion driving classified quota: ${detail}`);
    this.name = "BrowserVerifierQuotaError";
    this.resetAtMs = resetAtMs;
  }
}

export const BROWSER_PROMPT_VERSION = 2;

export interface BrowserVerifyPromptParams {
  readonly url: string;
  readonly assertion: string;
}

export function buildBrowserVerifyPrompt(params: BrowserVerifyPromptParams): string {
  const { url, assertion } = params;
  return `You are verifying one observable behavior of a running web application
through the browser MCP tools available in this session (their names start
with browser_), in this one session. Verify browser prompt template
version: ${BROWSER_PROMPT_VERSION}.

## What to do

Use the browser MCP tools to navigate to the URL below and check exactly
one assertion against what you actually observe there. Do not check
anything else and do not modify the page's state beyond what observing it
requires.

URL: ${url}

Assertion to check: ${assertion}

Take one screenshot with the browser screenshot tool as part of your check;
it is saved to disk automatically. Never paste image data into your reply.
If the screenshot tool fails, say so plainly rather than claiming a capture
exists.

## How to answer

Reply with exactly one JSON object and nothing else (no markdown fence, no
prose before or after it), matching this schema:

  {"pass": true or false, "detail": "one or two sentences on what you observed"}

## House style

No em dashes (U+2014) anywhere. Report only what you actually observed; a
failing or uncertain result reported honestly is correct behavior, not a
mistake.
`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Exported for unit testing without ever driving a real (or fake-script)
// claude session (FR-002): the assistant's final reply may or may not be
// wrapped in prose or a markdown fence, so a direct parse is tried first and
// a best-effort brace-extraction is tried second, never a guess at pass/fail
// when neither parses.
export function parseBrowserVerdict(text: string): BrowserAssertResult | null {
  const candidates = [text.trim()];
  const braceMatch = /\{[\s\S]*\}/.exec(text);
  if (braceMatch) candidates.push(braceMatch[0]);

  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (isRecord(parsed) && typeof parsed.pass === "boolean" && typeof parsed.detail === "string") {
      const screenshot = typeof parsed.screenshotPngBase64 === "string" ? parsed.screenshotPngBase64 : undefined;
      return { pass: parsed.pass, detail: parsed.detail, ...(screenshot !== undefined ? { screenshotPngBase64: screenshot } : {}) };
    }
  }
  return null;
}

function extractResultText(event: unknown): string | null {
  if (!isRecord(event)) return null;
  if (event.type === "result" && typeof event.result === "string") return event.result;
  return null;
}

export const DEFAULT_BROWSER_TIMEOUT_MS = 10 * 60_000;
export const DEFAULT_BROWSER_MAX_TURNS = 40;

// Pinned browser MCP server (D-10). Bumping this version is an authoring
// change to this spec's territory, never an incidental drift; bunx spawns
// it as a tool, so it stays out of package.json (the zero-runtime-dependency
// convention holds).
export const BROWSER_MCP_PACKAGE = "@playwright/mcp@0.0.78";

export interface CreateBrowserMcpVerifierParams {
  readonly repo: string;
  // 043 B-1: the seam the assertion session is driven through. Absent is
  // the production process driver (043 B-5). A `basic` driver cannot host
  // the MCP server set; the seam journals the degradation (043 B-6) and the
  // assertion is reported as not passed with the feature named.
  readonly driver?: Driver;
  // 040 B-1: an explicit override for a caller that has one (tests do). Absent
  // resolves the verify tier off the same profile the posture comes from, at
  // spawn time, so a pair set mid-run reaches the next assertion.
  readonly model?: string;
  readonly maxTurns?: number;
  readonly timeoutMs?: number;
  // The owning project's execution posture (spec 032 B-4), read at spawn
  // time when passed as a function. 032 D-3 gives a browser session no
  // special case: a guarded profile that omits the browser MCP tools fails
  // its assertions honestly at this gate rather than escalating itself.
  readonly profile?: ProfileSource;
}

// The server saves captures under its own --output-dir with names the model
// chooses; the newest PNG there becomes the assertion's screenshot. Returns
// undefined when nothing was captured (the verdict then simply carries no
// screenshot, which the evidence writer already tolerates). PNG only: the
// evidence writer names screenshot files `.png`, so a stray capture in
// another format must not be smuggled in under that extension.
function readNewestScreenshot(outputDir: string): string | undefined {
  let entries: string[];
  try {
    entries = fs.readdirSync(outputDir);
  } catch {
    return undefined;
  }
  let newest: { path: string; mtimeMs: number } | null = null;
  for (const name of entries) {
    if (!/\.png$/i.test(name)) continue;
    const path = join(outputDir, name);
    const stat = fs.statSync(path);
    if (newest === null || stat.mtimeMs > newest.mtimeMs) newest = { path, mtimeMs: stat.mtimeMs };
  }
  if (newest === null) return undefined;
  return fs.readFileSync(newest.path).toString("base64");
}

// The production BrowserVerifier (B-3, D-10): a fresh claude session per
// assertion, driven exactly like every other session in this codebase
// (spec 014's own runSession), handed a headless Playwright MCP server
// through a per-assertion strict `--mcp-config` (spec 014 D-10) and
// instructed to reply in buildBrowserVerifyPrompt's strict JSON schema. The
// server's --output-dir is a per-assertion temp dir: the model captures a
// screenshot with the browser tool (never inline), and the newest PNG found
// there afterwards is attached as the assertion's screenshot evidence. Kept
// thin on purpose and never constructed by verify.test.ts's scenarios
// (FR-002): those drive runVerifyStage against a hand-written fake
// BrowserVerifier instead, the same "never spawn the real claude in tests"
// convention spec 014's own session.test.ts documents. A live smoke check
// of this function against a real browser session is run manually, not
// checked into the suite (mirroring spec 014's own AC-2 live smoke).
export function createBrowserMcpVerifier(params: CreateBrowserMcpVerifierParams): BrowserVerifier {
  const driver = params.driver ?? createProcessDriver();

  return {
    async assert(url: string, assertion: string, context?: BrowserAssertContext): Promise<BrowserAssertResult> {
      const workDir = fs.mkdtempSync(join(tmpdir(), "verify-browser-"));
      try {
        const outputDir = join(workDir, "output");
        fs.mkdirSync(outputDir);
        const mcpConfigPath = join(workDir, "mcp-config.json");
        fs.writeFileSync(
          mcpConfigPath,
          JSON.stringify({
            mcpServers: {
              browser: {
                command: "bunx",
                args: [BROWSER_MCP_PACKAGE, "--headless", "--isolated", "--output-dir", outputDir],
              },
            },
          })
        );

        let resultText: string | null = null;
        const profile = resolveProfileSource(params.profile);
        const session = await driver.runSession({
          repo: context?.cwd ?? params.repo,
          ...(context?.fenceDir == null ? {} : { fenceDir: context.fenceDir }),
          tier: tierForStage("verify"),
          ...(params.model === undefined ? {} : { model: params.model }),
          maxTurns: params.maxTurns ?? DEFAULT_BROWSER_MAX_TURNS,
          timeoutMs: params.timeoutMs ?? DEFAULT_BROWSER_TIMEOUT_MS,
          mcpConfigPath,
          profile,
          prompt: buildBrowserVerifyPrompt({ url, assertion }),
          sink: (event) => {
            const text = extractResultText(event);
            if (text !== null) resultText = text;
          },
        });

        if (session.classification.kind === "quota") {
          throw new BrowserVerifierQuotaError(session.classification.detail, session.classification.resetAtMs);
        }
        if (session.classification.kind !== "completed") {
          return {
            pass: false,
            detail: `browser verification session did not complete (${session.classification.kind}): ${session.classification.detail}`,
          };
        }
        if (resultText === null) {
          return { pass: false, detail: "browser verification session completed with no result text to parse" };
        }
        const parsed = parseBrowserVerdict(resultText);
        if (!parsed) {
          return {
            pass: false,
            detail: `browser verification session's result text did not match the expected JSON schema: ${(resultText as string).slice(0, 500)}`,
          };
        }
        if (parsed.screenshotPngBase64 === undefined) {
          const screenshot = readNewestScreenshot(outputDir);
          if (screenshot !== undefined) return { ...parsed, screenshotPngBase64: screenshot };
        }
        return parsed;
      } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
    },
  };
}

// --- evidence and outcome shapes (B-4, FR-003) ------------------------------

export type VerifyOutcome = "passed" | "failed" | "not-declared" | "quota";

export interface VerifyCliEvidence {
  readonly blockIndex: number;
  readonly commandIndex: number;
  readonly command: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly durationMs: number;
  readonly evidenceHash: string;
  // 129 B-8: the refusals the supervisor counted while this line ran.
  readonly fenceRefusals: number;
}

export interface VerifyBrowserEvidence {
  readonly blockIndex: number;
  readonly assertionIndex: number;
  readonly url: string;
  readonly assertion: string;
  readonly pass: boolean;
  readonly detailHash: string;
  readonly screenshotHash: string | null;
  // 129 B-10: the refusals counted while this assertion's session ran.
  readonly fenceRefusals: number;
}

export interface VerifyFailure {
  readonly kind: "cli" | "browser";
  readonly description: string;
  readonly evidenceHash: string;
}

// 129 B-8, B-9: the same record the gate's evidence carries (B-3), with the
// reason an operator's allowance gives when there is no fence to apply.
export interface VerifyFenceRecord {
  readonly applied: boolean;
  readonly refusals: number;
  readonly reason?: "operator-allowed";
}

// 129 B-8: what acceptance.base records when no run's receipt names the base
// a merge was judged against. Never an inferred base.
export const ACCEPTANCE_BASE_UNRECORDED = "unrecorded";
export const ACCEPTANCE_BASE_KIND = "acceptance.base";
export const ACCEPTANCE_CHANGED_KIND = "acceptance.changed";

export interface VerifyEvidence {
  readonly specId: string;
  readonly sha: string;
  readonly declared: boolean;
  readonly parseError: string | null;
  readonly cli: readonly VerifyCliEvidence[];
  readonly browser: readonly VerifyBrowserEvidence[];
  readonly firstFailure: VerifyFailure | null;
  readonly evidenceDir: string;
  // B-5: true only when this is a re-verification run and the outcome is
  // failed (mirroring shepherd's own needsHuman convention, spec 018): the
  // upstream amendment broke a downstream contract, a human decision, not a
  // rebuild loop.
  readonly needsHuman: boolean;
  readonly quotaResetAtMs: number | null;
  // 129 B-8: the revision whose `## Verification` block ran, or "unrecorded"
  // when no run's receipt names one and the verified revision's block ran.
  readonly acceptanceBase: string;
  // 129 B-8, B-9: required, with an explicit zero.
  readonly fence: VerifyFenceRecord;
}

export interface VerifyResult {
  readonly outcome: VerifyOutcome;
  readonly evidence: VerifyEvidence;
}

// --- defaults ----------------------------------------------------------------

export const DEFAULT_CLI_TIMEOUT_MS = 5 * 60_000;

// --- acceptance at the base (129 B-8) ----------------------------------------

// The base revision of the run that produced `mergeSha`: the broker's merge
// outcome that answered this merge sha names the receipt it consumed, and that
// receipt names the base its gate judged against. Null when no brokered merge
// produced this sha (a re-verify at a later head, or a merge from before 122),
// which the stage records as "unrecorded" rather than guessing at a receipt.
export function consumedReceiptBase(records: readonly JournalRecord[], specId: string, mergeSha: string): string | null {
  let receiptHash: string | null = null;
  for (const record of records) {
    if (record.kind !== "broker.action") continue;
    const p = record.payload;
    if (typeof p !== "object" || p === null || Array.isArray(p)) continue;
    if (p.action === "merge" && p.phase === "outcome" && p.ok === true && p.specId === specId && p.detail === mergeSha) {
      if (typeof p.receiptHash === "string") receiptHash = p.receiptHash;
    }
  }
  if (receiptHash === null) return null;
  for (const record of records) {
    if (record.kind !== RECEIPT_KIND || record.recordHash !== receiptHash) continue;
    const receipt = parseReceipt(record.payload);
    return receipt !== null && receipt.specId === specId ? receipt.repo.baseSha : null;
  }
  return null;
}

// A section's identity for acceptance.changed: the sha256 of its text, or
// null when the spec declares no Verification section at that revision.
export function verificationDigest(section: string | null): string | null {
  return section === null ? null : createHash("sha256").update(section, "utf8").digest("hex");
}

export type VerifyAllowanceBinding = VerifyAllowance | (() => VerifyAllowance);

function resolveAllowance(binding: VerifyAllowanceBinding | undefined): VerifyAllowance {
  if (binding === undefined) return "fenced";
  return typeof binding === "function" ? binding() : binding;
}

// --- the stage (B-1 through B-5) --------------------------------------------

export interface RunVerifyStageOptions {
  readonly runner: VerifyRunner;
  readonly browserVerifier: BrowserVerifier;
  readonly specId: string;
  // The merged sha to verify (B-2): the caller (the daemon) supplies this
  // explicitly, the same "specId is always an explicit field, never
  // inferred" convention ship.ts's own D-6 established, since verify has no
  // "current branch" of its own to read it from.
  readonly sha: string;
  readonly journal: JournalHandle;
  readonly evidenceDir: string;
  readonly cliTimeoutMs?: number;
  // B-5: set by the daemon when this call is re-verifying a spec invalidated
  // per spec 012 B-4, rather than a first-time verify inside the normal
  // pipeline.
  readonly isReVerification?: boolean;
  // 129 B-9: the owning project's journaled verify allowance, read when the
  // stage runs. Absent is `fenced`.
  readonly allowance?: VerifyAllowanceBinding;
}

export async function runVerifyStage(options: RunVerifyStageOptions): Promise<VerifyResult> {
  const { runner, browserVerifier, specId, sha, journal, evidenceDir } = options;
  const cliTimeoutMs = options.cliTimeoutMs ?? DEFAULT_CLI_TIMEOUT_MS;
  const isReVerification = options.isReVerification ?? false;
  const specPath = `specs/${specId}/spec.md`;
  const allowance = resolveAllowance(options.allowance);

  // B-2: the clean checkout. Created before anything else runs (so even the
  // "is Verification even declared" read comes from the merged sha's own
  // spec.md, never a possibly-stale local copy) and removed on every exit
  // path, success or failure.
  const worktreePath = runner.addWorktree(sha);
  try {
    // 129 B-9: under an operator's `inherit` there is no fence to apply, and
    // the record says why; otherwise the fence beside the worktree applies.
    const fenceDir = allowance === "inherit" ? null : (runner.fenceFor?.(worktreePath) ?? null);
    const tally = (): FenceTally => (fenceDir === null ? NO_FENCE_TALLY : (runner.fenceTally?.() ?? NO_FENCE_TALLY));
    const stageStart = tally();
    const fenceRecord = (): VerifyFenceRecord =>
      allowance === "inherit"
        ? { applied: false, refusals: 0, reason: "operator-allowed" }
        : { applied: fenceDir !== null, refusals: tally().refusals - stageStart.refusals };
    const fencePayload = (): Record<string, JsonValue> => ({ ...fenceRecord() });

    const headBody = runner.readFile(join(worktreePath, specPath));

    // 129 B-8: the block the run was judged against, read at its base.
    const base = consumedReceiptBase(journal.fold().records, specId, sha);
    const acceptanceBase = base ?? ACCEPTANCE_BASE_UNRECORDED;
    journal.append(ACCEPTANCE_BASE_KIND, { specId, sha, base: acceptanceBase });

    let specBody = headBody;
    let baseUnreadable: string | null = null;
    if (base !== null) {
      const baseBody = runner.readFileAtRevision?.(base, specPath) ?? null;
      if (baseBody === null) {
        baseUnreadable = `the spec's acceptance could not be read at the run's base ${base}; nothing ran`;
      } else {
        specBody = baseBody;
        const baseSection = extractVerificationSection(baseBody);
        const headSection = extractVerificationSection(headBody);
        if (baseSection !== headSection) {
          journal.append(ACCEPTANCE_CHANGED_KIND, {
            specId,
            sha,
            baseSha: base,
            baseDigest: verificationDigest(baseSection),
            headDigest: verificationDigest(headSection),
          });
        }
      }
    }
    const parsed: ParseVerificationResult =
      baseUnreadable === null ? parseVerificationSection(specBody) : { declared: "error", message: baseUnreadable };

    const parsedPayload: Record<string, JsonValue> = {
      specId,
      sha,
      declared: parsed.declared === true,
      parseError: parsed.declared === "error" ? parsed.message : null,
      cliBlocks: parsed.declared === true ? parsed.cli.length : 0,
      browserBlocks: parsed.declared === true ? parsed.browser.length : 0,
      acceptanceBase,
    };
    journal.append("stage.verify.parsed", parsedPayload);

    if (parsed.declared === false) {
      const evidence: VerifyEvidence = {
        specId,
        sha,
        declared: false,
        parseError: null,
        cli: [],
        browser: [],
        firstFailure: null,
        evidenceDir,
        needsHuman: false,
        quotaResetAtMs: null,
        acceptanceBase,
        fence: fenceRecord(),
      };
      const resultPayload: Record<string, JsonValue> = { specId, sha, outcome: "not-declared", needsHuman: false, fence: fencePayload() };
      journal.append("stage.verify.result", resultPayload);
      return { outcome: "not-declared", evidence };
    }

    if (parsed.declared === "error") {
      const evidence: VerifyEvidence = {
        specId,
        sha,
        declared: true,
        parseError: parsed.message,
        cli: [],
        browser: [],
        firstFailure: null,
        evidenceDir,
        needsHuman: isReVerification,
        quotaResetAtMs: null,
        acceptanceBase,
        fence: fenceRecord(),
      };
      const resultPayload: Record<string, JsonValue> = {
        specId,
        sha,
        outcome: "failed",
        needsHuman: isReVerification,
        parseError: parsed.message,
        fence: fencePayload(),
      };
      journal.append("stage.verify.result", resultPayload);
      return { outcome: "failed", evidence };
    }

    // --- B-2: cli assertions, serial, run to completion (never stopped
    // early on a failure: AC-2's "both outputs recorded" needs every
    // assertion's evidence on disk regardless of which one failed first).
    const cliEvidence: VerifyCliEvidence[] = [];
    let firstFailure: VerifyFailure | null = null;

    for (const block of parsed.cli) {
      for (let i = 0; i < block.commands.length; i++) {
        const command = block.commands[i]!;
        const before = tally();
        const runResult = runner.runCommand(worktreePath, ["sh", "-c", command], cliTimeoutMs, allowance);
        const after = tally();
        const fenceRefusals = after.refusals - before.refusals;
        const combined = `$ ${command}\n\n--- stdout ---\n${runResult.stdout}\n--- stderr ---\n${runResult.stderr}`;
        const evidenceHash = writeTextEvidence(evidenceDir, combined, DEFAULT_EVIDENCE_TEXT_BYTES);

        const entry: VerifyCliEvidence = {
          blockIndex: block.blockIndex,
          commandIndex: i,
          command,
          exitCode: runResult.exitCode,
          timedOut: runResult.timedOut,
          durationMs: runResult.durationMs,
          evidenceHash,
          fenceRefusals,
        };
        cliEvidence.push(entry);

        const cliPayload: Record<string, JsonValue> = {
          specId,
          sha,
          blockIndex: entry.blockIndex,
          commandIndex: entry.commandIndex,
          command,
          exitCode: entry.exitCode,
          timedOut: entry.timedOut,
          evidenceHash,
          fenceRefusals,
        };
        journal.append("stage.verify.cli", cliPayload);

        // 129 B-8: a refusal fails the line whatever it exited (129 B-4's rule).
        const passed = !runResult.timedOut && runResult.exitCode === 0 && fenceRefusals === 0;
        if (!passed && firstFailure === null) {
          const refused =
            fenceRefusals > 0 ? ` (gate-fence-refused: reached for ${toolsBetween(before, after).join(" and ")})` : "";
          firstFailure = {
            kind: "cli",
            description: `verify:cli block ${entry.blockIndex + 1}, command ${entry.commandIndex + 1}: ${command}${refused}`,
            evidenceHash,
          };
        }
      }
    }

    if (firstFailure) {
      const evidence: VerifyEvidence = {
        specId,
        sha,
        declared: true,
        parseError: null,
        cli: cliEvidence,
        browser: [],
        firstFailure,
        evidenceDir,
        needsHuman: isReVerification,
        quotaResetAtMs: null,
        acceptanceBase,
        fence: fenceRecord(),
      };
      const resultPayload: Record<string, JsonValue> = {
        specId,
        sha,
        outcome: "failed",
        needsHuman: isReVerification,
        firstFailure: firstFailure.description,
        fence: fencePayload(),
      };
      journal.append("stage.verify.result", resultPayload);
      return { outcome: "failed", evidence };
    }

    // --- B-3: browser assertions, run to completion the same way, unless a
    // session classifies quota: that stops everything immediately, since no
    // further session can be driven without it (B-3, obeys the scheduler).
    const browserEvidence: VerifyBrowserEvidence[] = [];

    for (const block of parsed.browser) {
      for (let i = 0; i < block.assertions.length; i++) {
        const assertion = block.assertions[i]!;

        const before = tally();
        let assertResult: BrowserAssertResult;
        try {
          // 129 B-10: in the verify worktree, inside its fence.
          assertResult = await browserVerifier.assert(block.url, assertion, { cwd: worktreePath, fenceDir });
        } catch (err) {
          if (err instanceof BrowserVerifierQuotaError) {
            const quotaPayload: Record<string, JsonValue> = {
              specId,
              sha,
              blockIndex: block.blockIndex,
              assertionIndex: i,
              url: block.url,
              assertion,
              resetAtMs: err.resetAtMs,
            };
            journal.append("stage.verify.quota", quotaPayload);

            const evidence: VerifyEvidence = {
              specId,
              sha,
              declared: true,
              parseError: null,
              cli: cliEvidence,
              browser: browserEvidence,
              firstFailure: null,
              evidenceDir,
              needsHuman: false,
              quotaResetAtMs: err.resetAtMs,
              acceptanceBase,
              fence: fenceRecord(),
            };
            const resultPayload: Record<string, JsonValue> = { specId, sha, outcome: "quota", needsHuman: false, fence: fencePayload() };
            journal.append("stage.verify.result", resultPayload);
            return { outcome: "quota", evidence };
          }
          throw err;
        }
        const after = tally();
        const fenceRefusals = after.refusals - before.refusals;

        const detailHash = writeTextEvidence(evidenceDir, assertResult.detail, DEFAULT_EVIDENCE_TEXT_BYTES);
        // B-3: whatever the verifier returns is stored honestly; a session
        // that could not produce a screenshot leaves this null rather than
        // faking one.
        const screenshotHash = assertResult.screenshotPngBase64
          ? writeEvidenceFile(evidenceDir, Buffer.from(assertResult.screenshotPngBase64, "base64"), ".png")
          : null;

        const entry: VerifyBrowserEvidence = {
          blockIndex: block.blockIndex,
          assertionIndex: i,
          url: block.url,
          assertion,
          pass: assertResult.pass,
          detailHash,
          screenshotHash,
          fenceRefusals,
        };
        browserEvidence.push(entry);

        const browserPayload: Record<string, JsonValue> = {
          specId,
          sha,
          blockIndex: entry.blockIndex,
          assertionIndex: entry.assertionIndex,
          url: entry.url,
          assertion,
          pass: entry.pass,
          detailHash,
          screenshotHash,
          fenceRefusals,
        };
        journal.append("stage.verify.browser", browserPayload);

        if ((!assertResult.pass || fenceRefusals > 0) && firstFailure === null) {
          const refused =
            fenceRefusals > 0 ? ` (gate-fence-refused: reached for ${toolsBetween(before, after).join(" and ")})` : "";
          firstFailure = {
            kind: "browser",
            description: `verify:browser block ${entry.blockIndex + 1}, assertion ${entry.assertionIndex + 1} (${entry.url}): ${assertion}${refused}`,
            evidenceHash: detailHash,
          };
        }
      }
    }

    // --- B-4: verdict -------------------------------------------------------
    const outcome: VerifyOutcome = firstFailure ? "failed" : "passed";
    const needsHuman = outcome === "failed" && isReVerification;
    const evidence: VerifyEvidence = {
      specId,
      sha,
      declared: true,
      parseError: null,
      cli: cliEvidence,
      browser: browserEvidence,
      firstFailure,
      evidenceDir,
      needsHuman,
      quotaResetAtMs: null,
      acceptanceBase,
      fence: fenceRecord(),
    };
    const resultPayload: Record<string, JsonValue> = {
      specId,
      sha,
      outcome,
      needsHuman,
      firstFailure: firstFailure?.description ?? null,
      fence: fencePayload(),
    };
    journal.append("stage.verify.result", resultPayload);
    return { outcome, evidence };
  } finally {
    runner.removeWorktree(worktreePath);
  }
}
