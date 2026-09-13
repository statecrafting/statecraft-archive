// Spec 125: the credential fence (doc 04 §11, and the limit 122 recorded in
// B-7, §5 and D-4). Spec 122 moved publishing to the broker so every push,
// pull request and merge is journaled as intent and outcome over a receipt
// and a lease. The value of that boundary is the journal, and the journal is
// only complete if the broker is the only path that works.
//
// 122 scrubbed two token names from the candidate's environment and recorded
// what a name list cannot reach: a `gh` authenticated through the system
// keyring. The reach is wider still, because a repository whose origin is an
// ssh URL is pushed to from `SSH_AUTH_SOCK` or a key under `~/.ssh`. Neither
// is environment-variable shaped, so `CHILD_ENV_DENY` cannot close either
// however many names it grows.
//
// The fence therefore *constructs* the child's credential environment rather
// than filtering it: refusing shims first on PATH, git redirected to a
// config with no credential helper and no agent, and gh pointed at an empty
// config directory. The property bought is integrity, not confidentiality:
// the obvious move fails and names the broker, so a capable session cannot
// casually publish around the boundary and leave no record. A session that
// means to escape is not contained by this, and spec 125 §6 says so.
//
// Spec 129 carries the fence past the session to every other place the engine
// runs code a repository controls (the gate, the bracket, the engine's own
// git, the verify stage), and moves the count of refusals out of the fenced
// process's reach: each shim reports to the supervisor that spawned the work
// (129 B-3), whose count is the tally. The log stays as a legible copy.

import { randomBytes } from "crypto";
import * as fs from "fs";
import { join } from "path";

// What a shim exits with. 127 is "command not found", which is what a caller
// that shells out reads as "this tool is not here" without special casing.
export const FENCE_REFUSAL_EXIT = 127;

// The tools the fence refuses, in the order the supervisor counts them.
export const FENCED_TOOLS = ["gh", "ssh"] as const;
export type FencedTool = (typeof FENCED_TOOLS)[number];

// Exported so a remediation prompt can quote the refusal a gate may have
// swallowed (129 B-4): the text the session sees is the text the shim prints.
export const FENCE_MESSAGES: Readonly<Record<FencedTool, string>> = {
  gh: "gh is fenced in a driven session; publishing goes through the broker (spec 122). Write the PR text to the proposal drop box.",
  ssh: "ssh is fenced in a driven session; publishing goes through the broker (spec 122). The engine pushes on a receipt and a lease.",
};

// --- layout (B-2) ------------------------------------------------------------

// The fence sits beside the candidate, never inside it: a directory under the
// worktree would dirty the tree that 121 B-4 requires clean before a receipt.
export function fencePath(homeDir: string, project: string, branch: string): string {
  return join(homeDir, "fences", project, branch);
}

export function fenceBinDir(fenceDir: string): string {
  return join(fenceDir, "bin");
}

export function fenceRefusalLog(fenceDir: string): string {
  return join(fenceDir, "refusals.log");
}

// The shim source is a pure function of (fence directory, tool, channel), so a
// stale fence from a crashed run is overwritten rather than trusted (B-2).
//
// 129 B-3: with a channel, the shim reports its refusal to the supervisor and
// waits for the acknowledgement before it exits, so the refusal is counted by
// the time the process that ran it returns. The report runs under bash, whose
// `/dev/tcp` needs no client binary; a supervisor that is not listening (a
// fence left by a crashed daemon) refuses the connection at once, and the shim
// still refuses. Without a channel the shim is 125's, byte for byte.
export function shimSource(fenceDir: string, tool: FencedTool, channel: FenceChannelAddress | null = null): string {
  const log = JSON.stringify(fenceRefusalLog(fenceDir));
  const report =
    channel === null
      ? []
      : [
          "# Spec 129 B-3: report to the supervisor first; its count is the tally,",
          "# and the log below is a legible copy no stage reads a count from.",
          `{ exec 9<>/dev/tcp/127.0.0.1/${channel.port} && printf 'refused %s %s %s\\n' ${channel.slot} ${channel.secret} ${tool} >&9 && read -r -t ${REPORT_ACK_TIMEOUT_S} _ <&9; } 2>/dev/null`,
        ];
  return [
    channel === null ? "#!/bin/sh" : "#!/bin/bash",
    "# Spec 125: the credential fence. Generated on every openCandidate;",
    "# hand edits are overwritten. See specs/125-credential-fence/spec.md.",
    ...report,
    `printf '%s %s\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" ${tool} >> ${log} 2>/dev/null`,
    `printf '%s\\n' ${JSON.stringify(FENCE_MESSAGES[tool])} >&2`,
    `exit ${FENCE_REFUSAL_EXIT}`,
    "",
  ].join("\n");
}

// The operator's name and email, read from the daemon's own git before the
// fence is built (129 D-12). Identity is not a credential, and a git that no
// longer reads the operator's global configuration would otherwise commit
// under a guessed identity, or refuse to commit where none can be guessed.
export interface GitIdentity {
  readonly name: string | null;
  readonly email: string | null;
}

// An empty `credential.helper` resets the inherited helper chain rather than
// appending to it, which is the one git spelling that unsets a helper the
// operator configured globally or in a system file.
export function gitConfigSource(fenceDir: string, identity: GitIdentity | null = null): string {
  const user: string[] = [];
  if (identity !== null && (identity.name !== null || identity.email !== null)) {
    user.push("[user]");
    if (identity.name !== null) user.push(`\tname = ${JSON.stringify(identity.name)}`);
    if (identity.email !== null) user.push(`\temail = ${JSON.stringify(identity.email)}`);
  }
  return [
    "# Spec 125: the credential fence. Generated; hand edits are overwritten.",
    "[credential]",
    "\thelper =",
    "[core]",
    `\tsshCommand = ${JSON.stringify(join(fenceBinDir(fenceDir), "ssh"))}`,
    ...user,
    "",
  ].join("\n");
}

// --- construction (B-2) ------------------------------------------------------

export interface BuildFenceOptions {
  // 129 B-3: the supervisor the shims report to. Absent is 125's fence, whose
  // only record is the log.
  readonly channel?: FenceChannel | null;
  readonly identity?: GitIdentity | null;
}

// Idempotent: every call rewrites the shims and the config from the constants
// above and starts a fresh refusal tally for the round about to run, on the
// channel as in the log.
export function buildFence(fenceDir: string, options: BuildFenceOptions = {}): string {
  const bin = fenceBinDir(fenceDir);
  const channel = options.channel ?? null;
  fs.mkdirSync(bin, { recursive: true });
  // gh reads `hosts.yml` from its config directory; an empty one that exists
  // is the difference between "no credential" and "fall back to the default".
  fs.mkdirSync(join(fenceDir, "gh"), { recursive: true });
  for (const tool of FENCED_TOOLS) {
    const path = join(bin, tool);
    fs.writeFileSync(path, shimSource(fenceDir, tool, channel === null ? null : channel.address), { mode: 0o755 });
    // writeFileSync's mode applies on create only; an existing file keeps its
    // bits, and a fence reused from a crashed run must still be executable.
    fs.chmodSync(path, 0o755);
  }
  fs.writeFileSync(join(fenceDir, "gitconfig"), gitConfigSource(fenceDir, options.identity ?? null));
  fs.writeFileSync(fenceRefusalLog(fenceDir), "");
  channel?.reset();
  return fenceDir;
}

// --- the overlay (B-3) -------------------------------------------------------

// Applied over the deny-list scrub, never instead of it: the scrub is the
// subtractive half and keeps its contract role (121 B-3), this is the
// additive half. HOME is deliberately absent from the table; both providers
// authenticate from it (`~/.claude`, `~/.codex/auth.json`) and 014 B-2
// depends on that. Spec 125 §6 records what leaving it in place means.
export function fenceOverlay(fenceDir: string, inheritedPath: string | undefined): Record<string, string> {
  const bin = fenceBinDir(fenceDir);
  return {
    PATH: inheritedPath === undefined || inheritedPath.length === 0 ? bin : `${bin}:${inheritedPath}`,
    GH_CONFIG_DIR: join(fenceDir, "gh"),
    GIT_CONFIG_GLOBAL: join(fenceDir, "gitconfig"),
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: join(bin, "gh"),
    SSH_ASKPASS: join(bin, "gh"),
  };
}

// The environment a fenced session receives: a scrubbed base with the overlay
// applied. `scrubbed` comes from candidate.ts so the deny list stays one list.
export function applyFence(scrubbed: Record<string, string>, fenceDir: string | null): Record<string, string> {
  if (fenceDir === null) return scrubbed;
  return { ...scrubbed, ...fenceOverlay(fenceDir, scrubbed.PATH) };
}

// --- the log (B-7) -----------------------------------------------------------

// How many lines the refusal log holds. Since 129 B-3 this is the legible copy
// for a person reading the fence and nothing more: the log is a same-user file
// the refused process can truncate, so no stage reads a count from it. The
// count is the supervisor's (the channel below). A missing log is zero.
export function readFenceRefusals(fenceDir: string | null): number {
  if (fenceDir === null) return 0;
  let text: string;
  try {
    text = fs.readFileSync(fenceRefusalLog(fenceDir), "utf8");
  } catch {
    return 0;
  }
  return text.split("\n").filter((line) => line.trim().length > 0).length;
}

// --- the supervisor's count (129 B-3) ----------------------------------------

// Where a shim reports: a loopback port the supervisor listens on, the slot
// that is this fence's count, and the slot's secret, which keeps a stray
// connection (a port scan, a page in a browser) from counting as a refusal.
export interface FenceChannelAddress {
  readonly port: number;
  readonly slot: number;
  readonly secret: string;
}

export interface FenceTally {
  readonly refusals: number;
  readonly byTool: Readonly<Record<FencedTool, number>>;
}

// One supervisor's count of the refusals its fenced children reported. The
// count lives in memory the supervisor shares with the thread that listens;
// no process the supervisor spawned can reach it except to add a report, so a
// refusal once reported cannot be withdrawn (B-3's requirement). A child can
// still inflate the count by reporting falsely, which fails its own round and
// hides nothing.
export interface FenceChannel {
  readonly address: FenceChannelAddress;
  tally(): FenceTally;
  // Zeroes the count. Called by buildFence, so a rebuilt fence starts its
  // round from nothing, as the log does.
  reset(): void;
  // Returns the slot; a shim still holding its address counts nowhere. The
  // production runners hold their channel for their own life and never close
  // it (one build runner and one verify runner per project, against 4096
  // slots); the thread itself lives as long as the engine.
  close(): void;
}

const CHANNEL_SLOTS = 4096;
// Per slot: the gh count, the ssh count, and the secret as four 32-bit words.
const SLOT_WIDTH = 2 + 4;
const REPORT_ACK_TIMEOUT_S = 2;
const WARDEN_START_TIMEOUT_MS = 10_000;

// The listening thread. A worker rather than a listener on the engine's own
// thread because the gate and the verify stage's acceptance lines run under
// Bun.spawnSync, which blocks that thread for the length of the command; a
// shim reporting then would wait on a listener that cannot answer, and the
// supervisor could not read the count the moment the command returns. The
// worker answers while the engine waits, and the count it keeps is the
// engine's to read synchronously. Inline source, so a compiled engine carries
// it with no second entry point.
const WARDEN_SOURCE = `
const decoder = new TextDecoder();
self.onmessage = (event) => {
  const { buffer, slots, width } = event.data;
  const shared = new Int32Array(buffer);
  const pattern = /^refused ([0-9]+) ([0-9a-f]{32}) (gh|ssh)$/;
  const toolIndex = { gh: 0, ssh: 1 };
  const count = (line) => {
    const match = pattern.exec(line);
    if (match === null) return false;
    const slot = Number(match[1]);
    if (!(slot < slots)) return false;
    const base = 1 + slot * width;
    let open = false;
    for (let i = 0; i < 4; i++) {
      const expected = shared[base + 2 + i] >>> 0;
      if (expected !== 0) open = true;
      if (expected !== parseInt(match[2].slice(i * 8, i * 8 + 8), 16)) return false;
    }
    if (!open) return false;
    Atomics.add(shared, base + toolIndex[match[3]], 1);
    return true;
  };
  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.data = { text: "" };
      },
      data(socket, chunk) {
        const state = socket.data;
        state.text += decoder.decode(chunk);
        const end = state.text.indexOf("\\n");
        if (end === -1) {
          if (state.text.length > 256) socket.end();
          return;
        }
        if (count(state.text.slice(0, end))) socket.write("ok\\n");
        socket.end();
      },
      error() {},
    },
  });
  Atomics.store(shared, 0, server.port);
  Atomics.notify(shared, 0);
};
`;

interface Warden {
  readonly port: number;
  readonly shared: Int32Array;
  readonly free: number[];
  next: number;
}

let warden: Warden | null = null;

function startWarden(): Warden {
  const buffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * (1 + CHANNEL_SLOTS * SLOT_WIDTH));
  const shared = new Int32Array(buffer);
  const worker = new Worker(URL.createObjectURL(new Blob([WARDEN_SOURCE], { type: "application/javascript" })));
  worker.postMessage({ buffer, slots: CHANNEL_SLOTS, width: SLOT_WIDTH });
  // Synchronous by design: a fence is built inside openCandidate, which the
  // stages call synchronously, and its shims need the port written into them.
  Atomics.wait(shared, 0, 0, WARDEN_START_TIMEOUT_MS);
  const port = Atomics.load(shared, 0);
  if (port === 0) {
    worker.terminate();
    throw new Error("fence: the refusal channel did not start");
  }
  // The engine's lifetime is its own; a listening thread must not extend it.
  // Bun's Worker has unref; the DOM typing the web project checks this file
  // under does not declare it.
  (worker as unknown as { unref(): void }).unref();
  return { port, shared, free: [], next: 0 };
}

export function openFenceChannel(): FenceChannel {
  warden ??= startWarden();
  const { shared, port } = warden;
  const slot = warden.free.pop() ?? (warden.next < CHANNEL_SLOTS ? warden.next++ : -1);
  if (slot === -1) throw new Error(`fence: all ${CHANNEL_SLOTS} refusal channel slots are in use`);
  const base = 1 + slot * SLOT_WIDTH;
  const bytes = randomBytes(16);
  // A zero secret marks a closed slot; the low bit keeps an open one nonzero.
  bytes[3] = bytes[3]! | 1;
  let secret = "";
  for (let i = 0; i < 4; i++) {
    const word = bytes.readUInt32BE(i * 4);
    Atomics.store(shared, base + 2 + i, word | 0);
    secret += word.toString(16).padStart(8, "0");
  }
  Atomics.store(shared, base, 0);
  Atomics.store(shared, base + 1, 0);
  const free = warden.free;
  let closed = false;
  return {
    address: { port, slot, secret },
    tally(): FenceTally {
      const gh = Atomics.load(shared, base);
      const ssh = Atomics.load(shared, base + 1);
      return { refusals: gh + ssh, byTool: { gh, ssh } };
    },
    reset(): void {
      Atomics.store(shared, base, 0);
      Atomics.store(shared, base + 1, 0);
    },
    close(): void {
      if (closed) return;
      closed = true;
      for (let i = 0; i < SLOT_WIDTH; i++) Atomics.store(shared, base + i, 0);
      free.push(slot);
    },
  };
}

// The tools a later tally counted that an earlier one did not, by name, in
// FENCED_TOOLS order: what a record says was reached for in between.
export function toolsBetween(before: FenceTally, after: FenceTally): FencedTool[] {
  return FENCED_TOOLS.filter((tool) => after.byTool[tool] > before.byTool[tool]);
}

export const NO_FENCE_TALLY: FenceTally = { refusals: 0, byTool: { gh: 0, ssh: 0 } };
