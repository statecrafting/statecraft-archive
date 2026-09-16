// The driver seam (spec 043): the one way the engine drives a session.
//
// The engine never spawns a provider and never parses one. It spawns a
// driver member (`statecraft-driver-<name>`, 042 B-1) as a process, writes
// one provider-neutral request to its stdin, and reads a line-delimited
// event stream off its stdout (B-2):
//
//   {"event":"journal","kind":"session.init","payload":{...}}
//   {"event":"stream","raw":<the provider's own event, verbatim>}
//   {"event":"journal","kind":"session.result","payload":{...}}
//   {"event":"result","result":<SessionResult>}
//
// The engine journals the `journal` events itself (B-3, D-3): the driver
// holds no journal path, and the payloads are the ones spec 014 wrote when
// runSession held the journal in-process, forwarded rather than rebuilt, so
// the chain shape is unchanged. Every `stream` event reaches the sink the
// stages inject, exactly as session.ts's sink did. Kill and deadline (B-4)
// act on the member process; the member forwards to the provider child.
//
// Nothing in this file names a provider. The strings that do live under
// src/members/ and in session.ts, and engine-bundle.test.ts proves the
// compiled engine carries none of them (FR-005).
import { existsSync, statSync } from "fs";
import { homedir } from "os";
import { delimiter, join, resolve } from "path";
import type { JournalHandle, JsonValue } from "./journal";
import type { ExecutionProfile, ProfileSource } from "./profile";
import { DEFAULT_REGISTRATION_PROFILE, profilePayload, resolveProfileSource } from "./profile";
import { scrubEnv } from "./candidate";
import { applyFence } from "./fence";
import { qualificationDir, qualificationFor, UNQUALIFIED_KIND } from "./qualification";
import {
  decide,
  parseCapabilityList,
  REQUEST_CAPABILITIES,
  requirementsFor,
  requirementsPayload,
  tierFor,
  type Capability,
  type Requirements,
} from "./capabilities";
import type { ModelTier } from "./models";

// The result and classification shapes are the driver's to define (014);
// the engine consumes them as data. Type-only re-exports are erased by the
// compiler, so the engine bundle's import graph does not reach session.ts.
export type { SessionResult, OverflowInfo, SessionEventSink } from "./session";
export type { Classification, TerminationKind } from "./classify-termination";
import type { SessionResult, SessionEventSink } from "./session";
import type { TerminationKind } from "./classify-termination";

// --- the seam (B-1) ---------------------------------------------------------

export type CapabilityTier = "reference" | "basic";

export interface DriverSessionRequest {
  readonly repo: string;
  readonly prompt: string;
  // A model tier (040 B-2) the driver resolves to an id; an explicit `model`
  // wins when present (040 B-1). The engine never names a model id itself.
  readonly tier?: ModelTier;
  readonly model?: string;
  readonly maxTurns?: number;
  readonly timeoutMs?: number;
  // Reference-tier feature (B-6): an MCP server set the session must see.
  readonly mcpConfigPath?: string;
  readonly profile?: ExecutionProfile;
  readonly killGraceMs?: number;
  // 120 B-3: tokens the caller requires or prefers beyond what the request
  // implies. The seam derives the rest (120 B-4) and decides before spawn.
  readonly requirements?: Requirements;
  // 125 B-3: the credential fence built beside this session's candidate.
  // Present, the member (and through it the provider) is spawned with the
  // fence overlay: refusing `gh` and `ssh` first on PATH, and git pointed
  // away from every inherited credential helper. Absent, the session gets
  // the plain scrub, which is the in-place mode 121 D-5 keeps.
  readonly fenceDir?: string;
  // The two engine callbacks the process cannot carry.
  readonly journal?: JournalHandle;
  readonly sink?: SessionEventSink;
}

export interface Driver {
  readonly name: string;
  // Read from the member manifest (042 B-8), consumed as a declaration (D-4).
  tier(): Promise<CapabilityTier>;
  runSession(request: DriverSessionRequest): Promise<SessionResult>;
  // Severs the live session (021 B-6): SIGTERM to the member, which forwards
  // it to the provider child. True when something was in flight.
  killLiveSession(graceMs?: number): boolean;
}

// The request as it crosses the process boundary: the engine callbacks
// removed, the profile serialized the way the journal already does (032
// B-5), so a driver reads mode, tool lists and the model pair verbatim.
export interface DriverWireRequest {
  readonly schemaVersion: "1";
  readonly repo: string;
  readonly prompt: string;
  readonly tier: ModelTier | null;
  readonly model: string | null;
  readonly maxTurns: number | null;
  readonly timeoutMs: number | null;
  readonly mcpConfigPath: string | null;
  readonly profile: Record<string, JsonValue> | null;
  readonly killGraceMs: number | null;
  // 120 B-3: explicit lists, possibly empty; the schema stays "1" because
  // both parsers read absence as empty (120 D-4).
  readonly requirements: { required: Capability[]; preferred: Capability[] };
}

export function toWireRequest(request: DriverSessionRequest): DriverWireRequest {
  const profile = request.profile ?? DEFAULT_REGISTRATION_PROFILE;
  return {
    schemaVersion: "1",
    repo: resolve(request.repo),
    prompt: request.prompt,
    tier: request.tier ?? null,
    model: request.model ?? null,
    maxTurns: request.maxTurns ?? null,
    timeoutMs: request.timeoutMs ?? null,
    mcpConfigPath: request.mcpConfigPath ?? null,
    profile: request.profile === undefined ? null : profilePayload(request.profile),
    killGraceMs: request.killGraceMs ?? null,
    requirements: requirementsPayload(requirementsFor(profile, request)),
  };
}

// --- events (B-2) -----------------------------------------------------------

export type DriverEvent =
  | { readonly event: "journal"; readonly kind: string; readonly payload: JsonValue }
  | { readonly event: "stream"; readonly raw: unknown }
  | { readonly event: "result"; readonly result: SessionResult };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseDriverEvent(line: string): DriverEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  switch (parsed.event) {
    case "journal":
      if (typeof parsed.kind !== "string" || !("payload" in parsed)) return null;
      return { event: "journal", kind: parsed.kind, payload: parsed.payload as JsonValue };
    case "stream":
      return { event: "stream", raw: parsed.raw };
    case "result": {
      if (!isRecord(parsed.result)) return null;
      // 119 B-6: a driver built before the denial fields existed answers
      // without them; absence reads as none, never as unknown.
      const raw = parsed.result;
      const denials = typeof raw.denials === "number" ? raw.denials : 0;
      const denialSamples = Array.isArray(raw.denialSamples)
        ? raw.denialSamples.filter((v): v is string => typeof v === "string")
        : [];
      return { event: "result", result: { ...raw, denials, denialSamples } as unknown as SessionResult };
    }
    default:
      return null;
  }
}

// --- discovery (B-5) ---------------------------------------------------------

export const MEMBER_PREFIX = "statecraft-driver-";
export const MEMBER_DIR_ENV = "STATECRAFT_MEMBER_DIR";
export const DRIVER_BIN_ENV = "STATECRAFT_DRIVER_BIN";
export const DEFAULT_DRIVER_NAME = "claude";

// The umbrella's managed member directory (statecraft-cli 008 §4), resolved
// the same way so the engine and the umbrella find the same binary.
export function managedMemberDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env[MEMBER_DIR_ENV];
  if (explicit !== undefined && explicit.length > 0) return explicit;
  const xdg = env.XDG_DATA_HOME;
  if (xdg !== undefined && xdg.length > 0) return join(xdg, "statecraft", "members");
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "statecraft", "members");
  return join(homedir(), ".local", "share", "statecraft", "members");
}

function isExecutableFile(path: string): boolean {
  try {
    const st = statSync(path);
    return st.isFile() && (st.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

// Whether this module runs from a checkout rather than a compiled bundle:
// inside a `bun build --compile` binary import.meta.dir is a virtual path
// that exists nowhere on disk.
function runningFromSource(): boolean {
  return existsSync(join(import.meta.dir, "..", "..", "package.json"));
}

export interface ResolvedDriverCommand {
  readonly argv: readonly string[];
  readonly location: "explicit" | "managed" | "path" | "source";
}

// The command that runs the driver member: `STATECRAFT_DRIVER_BIN`, else
// the managed directory, else PATH, else (from a checkout only) the member
// entrypoint under bun. Null when nothing is found.
export function resolveDriverCommand(
  name: string,
  env: NodeJS.ProcessEnv = process.env
): ResolvedDriverCommand | null {
  const explicit = env[DRIVER_BIN_ENV];
  if (explicit !== undefined && explicit.length > 0) return { argv: [explicit], location: "explicit" };
  const binary = `${MEMBER_PREFIX}${name}`;
  const managed = managedMemberDir(env);
  if (managed !== null) {
    const candidate = join(managed, binary);
    if (isExecutableFile(candidate)) return { argv: [candidate], location: "managed" };
  }
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (dir.length === 0) continue;
    const candidate = join(dir, binary);
    if (isExecutableFile(candidate)) return { argv: [candidate], location: "path" };
  }
  if (runningFromSource()) {
    const entry = join(import.meta.dir, "..", "members", `${name === DEFAULT_DRIVER_NAME ? "driver" : `driver-${name}`}.ts`);
    if (existsSync(entry)) return { argv: [process.execPath, entry], location: "source" };
  }
  return null;
}

export function describeSearch(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const managed = managedMemberDir(env) ?? "(no managed directory)";
  return `${DRIVER_BIN_ENV} unset; ${MEMBER_PREFIX}${name} not in ${managed} or on PATH`;
}

// --- the process driver ---------------------------------------------------------

export const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
export const KILL_GRACE_MS = 5000;
// How long past the member's own deadline the engine waits for `result`
// before killing the member itself (B-4). The member enforces the session
// deadline; this covers a member that hangs after its child is gone.
export const DEADLINE_SLACK_MS = 10_000;
// How long to keep draining the member's pipes after it has exited. A
// grandchild that inherited them can hold them open indefinitely (014 has
// the same bound for the provider's own orphans).
export const PIPE_DRAIN_GRACE_MS = 2000;
export const STDERR_TAIL_BYTES = 16 * 1024;

export interface CreateProcessDriverParams {
  readonly name?: string;
  // The driver command, when the caller has one (tests do, the CLI's env
  // does). Absent resolves per B-5 at first use.
  readonly driverBin?: string;
  // The tier, when the caller already knows it. Absent asks the member for
  // its manifest once (042 B-3) and caches the answer.
  readonly tier?: CapabilityTier;
  // 120 B-5: the tokens the driver supports, when the caller already knows
  // them. Absent reads the manifest; a manifest without the field (an older
  // member) derives them from its tier.
  readonly capabilities?: readonly Capability[];
  readonly env?: NodeJS.ProcessEnv;
  // How long past the session deadline plus grace the engine waits for a
  // member's `result` before killing the member (B-4). Tests shorten it.
  readonly deadlineSlackMs?: number;
}

export class DriverNotFoundError extends Error {
  constructor(name: string, detail: string) {
    super(`driver: no driver member for "${name}": ${detail}`);
    this.name = "DriverNotFoundError";
  }
}

interface ManifestLike {
  readonly capabilityTier?: unknown;
  readonly capabilities?: unknown;
}

// 120 B-5: what an older manifest's tier says about its tokens: a reference
// driver supports the four request tokens, a basic one none of them.
function capabilitiesForTier(tier: CapabilityTier): readonly Capability[] {
  return tier === "reference" ? REQUEST_CAPABILITIES : [];
}

export const REFUSED_KIND = "driver.refused";

function tailBytes(text: string, max: number): string {
  return text.length <= max ? text : text.slice(text.length - max);
}

// The result the engine synthesizes when the member never produced one: a
// classification the stages already handle, with the detail naming the
// driver rather than the provider.
function synthesizedResult(kind: TerminationKind, detail: string, durationMs: number, stderrTail: string): SessionResult {
  return {
    classification: { kind, resetAtMs: null, detail },
    exitCode: null,
    durationMs,
    numTurns: null,
    costMicroUsd: null,
    usage: null,
    sessionId: null,
    transcriptPath: null,
    overflow: { lines: [], truncatedCount: 0 },
    stderrTail,
    denials: 0,
    denialSamples: [],
  };
}

// The `session.result` payload for a synthesized result, field for field
// what session.ts writes, so a reader sees one shape whether the session
// ended in the provider or in the driver.
function synthesizedResultPayload(result: SessionResult): Record<string, JsonValue> {
  return {
    classification: result.classification.kind,
    resetAtMs: result.classification.resetAtMs,
    detail: result.classification.detail,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    numTurns: result.numTurns,
    costMicroUsd: result.costMicroUsd,
    usage: result.usage,
    sessionId: result.sessionId,
    transcriptPath: result.transcriptPath,
    overflowLineCount: result.overflow.lines.length,
    overflowTruncatedCount: result.overflow.truncatedCount,
    stderrTail: result.stderrTail,
    resultTextTail: null,
    denials: result.denials,
    denialSamples: [...result.denialSamples],
  };
}

export const DEGRADED_KIND = "driver.degraded";

// Every live session across every process driver in this process, so the
// daemon's shutdown path (021 B-6) can sever whichever one is in flight
// without holding a handle through the stage call stack: the shape
// session.ts's killLiveSession had, over the seam instead of the provider.
const liveKills = new Set<(graceMs?: number) => void>();

// 124 B-6: once per process driver (one per driver name for a daemon's
// life, 117 B-3), so the record says it once and a test can count on it.
function noteQualification(
  driver: string,
  initPayload: JsonValue,
  journal: JournalHandle,
  reported: { done: boolean },
  env: NodeJS.ProcessEnv
): void {
  if (reported.done) return;
  const version =
    typeof initPayload === "object" && initPayload !== null && !Array.isArray(initPayload) && typeof initPayload.binaryVersion === "string"
      ? initPayload.binaryVersion
      : null;
  const verdict = qualificationFor(driver, version, qualificationDir(env));
  if (verdict.qualified) return;
  reported.done = true;
  journal.append(UNQUALIFIED_KIND, { driver, binaryVersion: version, recorded: verdict.record?.binary.version ?? null });
}

export function killLiveSession(graceMs?: number): boolean {
  if (liveKills.size === 0) return false;
  for (const kill of [...liveKills]) kill(graceMs);
  return true;
}

export function createProcessDriver(params: CreateProcessDriverParams = {}): Driver {
  const name = params.name ?? DEFAULT_DRIVER_NAME;
  // 121 B-3: the member is spawned with a scrubbed environment, and scrubs
  // again for its own child; the deny list is one list, in candidate.ts.
  const env = scrubEnv(params.env ?? process.env);
  let command: readonly string[] | null = params.driverBin !== undefined ? [params.driverBin] : null;
  let cachedTier: CapabilityTier | null = params.tier ?? null;
  let cachedCapabilities: readonly Capability[] | null =
    params.capabilities ?? (params.tier !== undefined ? capabilitiesForTier(params.tier) : null);
  let liveKill: ((graceMs?: number) => void) | null = null;
  const unqualifiedReported = { done: false };

  function resolveCommand(): readonly string[] {
    if (command !== null) return command;
    const resolved = resolveDriverCommand(name, env);
    if (resolved === null) throw new DriverNotFoundError(name, describeSearch(name, env));
    command = resolved.argv;
    return command;
  }

  async function tier(): Promise<CapabilityTier> {
    if (cachedTier !== null) return cachedTier;
    const argv = [...resolveCommand(), "--member-manifest"];
    const proc = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe", env });
    const [text, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (code !== 0) throw new Error(`driver: ${argv[0]} --member-manifest exited ${code}`);
    let manifest: ManifestLike;
    try {
      manifest = JSON.parse(text) as ManifestLike;
    } catch (err) {
      throw new Error(`driver: ${argv[0]} manifest does not parse: ${(err as Error).message}`);
    }
    const declared = manifest.capabilityTier;
    if (declared !== "reference" && declared !== "basic") {
      throw new Error(`driver: ${argv[0]} manifest declares no capability tier`);
    }
    // 120 B-2: the tokens, when declared, must agree with the tier; an
    // older manifest without them is read by its tier alone.
    if (manifest.capabilities !== undefined && manifest.capabilities !== null) {
      const tokens = parseCapabilityList(manifest.capabilities, `driver: ${argv[0]} manifest capabilities`);
      const derived = tierFor(tokens);
      if (derived !== declared) {
        throw new Error(`driver: ${argv[0]} manifest declares capabilityTier ${declared} but its capabilities derive ${derived}`);
      }
      cachedCapabilities = tokens;
    } else {
      cachedCapabilities = capabilitiesForTier(declared);
    }
    cachedTier = declared;
    return cachedTier;
  }

  async function capabilities(): Promise<readonly Capability[]> {
    if (cachedCapabilities !== null) return cachedCapabilities;
    await tier();
    return cachedCapabilities ?? [];
  }

  async function runSession(request: DriverSessionRequest): Promise<SessionResult> {
    const startedAtMs = Date.now();
    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const killGraceMs = request.killGraceMs ?? KILL_GRACE_MS;

    // 120 B-5 (043 B-6 before it): the manifest is a declaration the engine
    // honors before spawning. A required token the driver lacks refuses the
    // session with no process started; a preferred one it lacks is
    // journaled and the session runs.
    const requirements = requirementsFor(request.profile ?? DEFAULT_REGISTRATION_PROFILE, request);
    if (requirements.required.length > 0 || requirements.preferred.length > 0) {
      const supported = await capabilities();
      const declared = await tier();
      const decision = decide(supported, requirements);
      if (decision.refused.length > 0) {
        // 043 B-6's record keeps its shape for the case it named; the
        // preferred degradations are moot for a session that never runs.
        for (const feature of decision.refused) {
          request.journal?.append(DEGRADED_KIND, { driver: name, tier: declared, feature });
        }
        request.journal?.append(REFUSED_KIND, {
          driver: name,
          tier: declared,
          required: [...requirements.required],
          unsupported: [...decision.refused],
        });
        const detail = decision.refused.includes("mcp-config")
          ? `driver "${name}" is ${declared} tier and cannot host an MCP server set (mcp-config)`
          : `driver "${name}" does not support required capabilities: ${decision.refused.join(", ")}`;
        const result = synthesizedResult("crashed", detail, 0, "");
        request.journal?.append("session.result", synthesizedResultPayload(result));
        return result;
      }
      for (const feature of decision.degraded) {
        request.journal?.append(DEGRADED_KIND, { driver: name, tier: declared, feature });
      }
    }

    let argv: readonly string[];
    try {
      argv = [...resolveCommand(), "session", "run"];
    } catch (err) {
      const detail = (err as Error).message;
      const result = synthesizedResult("crashed", detail, 0, "");
      request.journal?.append("session.result", synthesizedResultPayload(result));
      return result;
    }

    // 125 B-3: the overlay rides on top of the scrub for this session only.
    // The member re-scrubs for its own child and forwards the rest, so the
    // provider inherits the fence without the member knowing about it.
    const proc = Bun.spawn([...argv], {
      cwd: resolve(request.repo),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: applyFence(env, request.fenceDir ?? null),
    });

    const state = {
      exited: false,
      killedByEngine: false,
      killedForDeadline: false,
      result: null as SessionResult | null,
      stderr: "",
      graceTimer: null as ReturnType<typeof setTimeout> | null,
      deadlineTimer: null as ReturnType<typeof setTimeout> | null,
    };

    const sever = (graceMs: number): void => {
      if (state.exited) return;
      proc.kill("SIGTERM");
      state.graceTimer = setTimeout(() => {
        if (!state.exited) proc.kill("SIGKILL");
      }, graceMs);
    };

    liveKill = (graceMs = killGraceMs) => {
      if (state.exited || state.killedByEngine) return;
      state.killedByEngine = true;
      sever(graceMs);
    };
    liveKills.add(liveKill);

    // B-4: the member enforces the session deadline; this is the backstop
    // for a member that never answers.
    state.deadlineTimer = setTimeout(() => {
      if (state.exited || state.result !== null) return;
      state.killedForDeadline = true;
      sever(killGraceMs);
    }, timeoutMs + killGraceMs + (params.deadlineSlackMs ?? DEADLINE_SLACK_MS));

    try {
      proc.stdin.write(JSON.stringify(toWireRequest(request)));
      await proc.stdin.end();
    } catch {
      // A member severed before the request landed still unwinds below.
    }

    const readStdout = (async () => {
      let buffer = "";
      const decoder = new TextDecoder();
      for await (const chunk of proc.stdout) {
        buffer += decoder.decode(chunk, { stream: true });
        let nl = buffer.indexOf("\n");
        while (nl !== -1) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          handle(line);
          nl = buffer.indexOf("\n");
        }
      }
      if (buffer.length > 0) handle(buffer);
    })();

    const readStderr = (async () => {
      const decoder = new TextDecoder();
      for await (const chunk of proc.stderr) {
        state.stderr = tailBytes(state.stderr + decoder.decode(chunk, { stream: true }), STDERR_TAIL_BYTES);
      }
    })();

    function handle(line: string): void {
      if (line.trim().length === 0) return;
      const event = parseDriverEvent(line);
      if (event === null) {
        // A line that is not an event is the member talking out of turn;
        // keep it where a stderr line would land, never on the chain.
        state.stderr = tailBytes(`${state.stderr}${line}\n`, STDERR_TAIL_BYTES);
        return;
      }
      switch (event.event) {
        case "journal":
          request.journal?.append(event.kind, event.payload);
          // 124 B-6: the init names the binary version; a version with no
          // qualification record is journaled once per driver per process,
          // and the session runs.
          if (event.kind === "session.init" && request.journal !== undefined) {
            noteQualification(name, event.payload, request.journal, unqualifiedReported, env);
          }
          return;
        case "stream":
          request.sink?.(event.raw);
          return;
        case "result":
          state.result = event.result;
          return;
      }
    }

    const exitCode = await proc.exited;
    state.exited = true;
    if (state.graceTimer !== null) clearTimeout(state.graceTimer);
    if (state.deadlineTimer !== null) clearTimeout(state.deadlineTimer);
    if (liveKill !== null) liveKills.delete(liveKill);
    liveKill = null;
    await Promise.race([Promise.all([readStdout, readStderr]), Bun.sleep(PIPE_DRAIN_GRACE_MS)]);

    if (state.result !== null) return state.result;

    // The member exited without a result: the failure is the driver's, and
    // the record says so in the shape every other end has.
    const durationMs = Date.now() - startedAtMs;
    const kind: TerminationKind = state.killedByEngine ? "killed" : "crashed";
    const detail = state.killedByEngine
      ? `driver "${name}" severed by the engine before it produced a result`
      : state.killedForDeadline
        ? `driver "${name}" produced no result within the deadline and was killed`
        : `driver "${name}" exited ${exitCode} without a result`;
    const result = synthesizedResult(kind, detail, durationMs, state.stderr);
    request.journal?.append("session.result", synthesizedResultPayload(result));
    return result;
  }

  return {
    name,
    tier,
    runSession,
    killLiveSession(graceMs?: number): boolean {
      if (liveKill === null) return false;
      liveKill(graceMs);
      return true;
    },
  };
}

// --- the per-project driver, late-bound (spec 117 B-3) ----------------------

export interface CreateProfileDriverParams {
  // The project's profile, as a value or as the function the scheduler's
  // wiring passes (032 B-4), read at every call rather than once.
  readonly profile: ProfileSource | undefined;
  readonly env?: NodeJS.ProcessEnv;
  readonly deadlineSlackMs?: number;
  // A factory for tests; production builds process drivers.
  readonly make?: (name: string) => Driver;
}

// A Driver that follows the profile: the name is `profile.driver`, else the
// seam's default, resolved when a call is made, and one process driver per
// name is kept because each holds its own lazily resolved command and tier
// (117 D-2). A driver set mid-flight therefore reaches the next spawn, the
// way a mode set mid-flight does, rather than the next daemon restart.
export function createProfileDriver(params: CreateProfileDriverParams): Driver {
  const drivers = new Map<string, Driver>();
  const make =
    params.make ??
    ((name: string) =>
      createProcessDriver({
        name,
        ...(params.env === undefined ? {} : { env: params.env }),
        ...(params.deadlineSlackMs === undefined ? {} : { deadlineSlackMs: params.deadlineSlackMs }),
      }));
  function current(): Driver {
    const name = resolveProfileSource(params.profile).driver ?? DEFAULT_DRIVER_NAME;
    let driver = drivers.get(name);
    if (driver === undefined) {
      driver = make(name);
      drivers.set(name, driver);
    }
    return driver;
  }
  return {
    get name(): string {
      return current().name;
    },
    tier: () => current().tier(),
    runSession: (request) => current().runSession(request),
    killLiveSession(graceMs?: number): boolean {
      let any = false;
      for (const driver of drivers.values()) any = driver.killLiveSession(graceMs) || any;
      return any;
    },
  };
}
