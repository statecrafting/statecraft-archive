// Spec 113 FR-003: the Rust journal and the TypeScript journal agree on
// every chain and bundle that exists, on chains each writes, on the bytes
// of an export, and on where a tampered bundle first breaks. The Rust
// binary is built here so the check cannot pass against a stale one.
import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openJournal, verifyChain } from "../orchestrator/journal";
import { exportBundleFromRoot, parseBundle, serializeBundle, verifyBundle } from "../orchestrator/export";

const REPO = join(import.meta.dir, "..", "..", "..");
const RUST_BIN = join(REPO, "target", "debug", "statecraft-journal");
const EVIDENCE = join(REPO, "docs", "evidence", "journal-bundle.json");

interface Ran {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function run(cmd: readonly string[], cwd = REPO): Promise<Ran> {
  const proc = Bun.spawn([...cmd], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1" } });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

function fresh(): string {
  return mkdtempSync(join(tmpdir(), "journal-parity-"));
}

// A chain covering what the bundle policy has to say about: included and
// withheld kinds, stripped fields, private paths at depth, nested objects,
// integer-like keys, unicode.
function writeChainWithTypescript(root: string): void {
  const work = openJournal(root);
  try {
    work.append("run.created", { runId: "r-1", specIds: ["012-x", "013-y"], n: 3 });
    work.append("state.transition.intent", { from: "idle", to: "building", detail: "free text goes away" });
    work.append("session.result", {
      classification: "completed",
      costMicroUsd: 51827,
      usage: { input_tokens: 100, output_tokens: 42 },
      transcriptPath: "/Users/u/.claude/projects/x/s.jsonl",
      stderrTail: "",
      nested: { keep: 1, path: "/tmp/private" },
      keys: { "10": "b", "9": "a", a: "c" },
    });
    work.append("run.blocked", { reason: "withheld whole: kind is not on the allowlist" });
    work.append("stage.build.result", { outcome: "passed", sha: "abc", unicode: "héllo wörld ☃" });
  } finally {
    work.close();
  }
  const decisions = openJournal(root, "decisions");
  try {
    decisions.append("decision.sealed", {
      id: "d1",
      specId: "012-x",
      scope: ["012-x", "src/dag.ts"],
      title: "t",
      decision: "d",
      rationale: "r",
    });
  } finally {
    decisions.close();
  }
}

test("the Rust journal builds", async () => {
  const built = await run(["cargo", "build", "-p", "statecraft-journal"]);
  expect(built.code).toBe(0);
}, 600_000);

test("FR-003 (a): both verifiers reverify the committed evidence bundle with the same counts", async () => {
  const text = readFileSync(EVIDENCE, "utf8");
  const parsed = parseBundle(text);
  if (!parsed.ok) throw new Error(parsed.reason);
  const ts = verifyBundle(parsed.bundle);
  const rs = await run([RUST_BIN, "verify-bundle", EVIDENCE, "--json"]);
  expect(rs.code).toBe(0);
  const envelope = JSON.parse(rs.stdout) as { ok: boolean; data: { chains: unknown } };
  expect(envelope.ok).toBe(true);
  if (!ts.ok) throw new Error("the TypeScript verifier refused the evidence bundle");
  expect(envelope.data.chains).toEqual({ ok: "true", chains: ts.chains } as unknown);
  expect(ts).toEqual({
    ok: true,
    chains: [
      { chain: "work", records: 1038, payloadsVerified: 676, payloadsRedacted: 97, payloadsWithheld: 265 },
      { chain: "decisions", records: 52, payloadsVerified: 51, payloadsRedacted: 1, payloadsWithheld: 0 },
    ],
  });
});

test("FR-003 (b): a chain each side writes verifies under the other", async () => {
  const root = fresh();
  writeChainWithTypescript(root);
  const rs = await run([RUST_BIN, "verify", "--dir", root, "--json"]);
  expect(rs.code).toBe(0);
  const envelope = JSON.parse(rs.stdout) as { ok: boolean; data: { chains: { chain: string; ok: boolean; count: number }[] } };
  expect(envelope.data.chains).toEqual([
    { chain: "work", ok: true, count: 5 },
    { chain: "decisions", ok: true, count: 1 },
  ]);
  // The Rust writer extends the TypeScript chain, and the TypeScript reader
  // verifies the result: the anchor, the link and the bytes are one format.
  const extend = await run([
    "cargo",
    "run",
    "-q",
    "-p",
    "statecraft-journal",
    "--example",
    "append",
    "--",
    root,
    "stage.ship.result",
    JSON.stringify({ outcome: "passed", keys: { "10": 1, "9": 2 } }),
  ]);
  expect(extend.code).toBe(0);
  expect(verifyChain(root)).toEqual({ ok: true, count: 6 });
  const lines = readFileSync(join(root, "journal.jsonl"), "utf8").trimEnd().split("\n");
  expect(lines[5]).toContain('"payload":{"keys":{"10":1,"9":2},"outcome":"passed"}');
}, 600_000);

test("FR-003 (c): a bundle exported by either implementation is the same bytes", async () => {
  const root = fresh();
  writeChainWithTypescript(root);
  const ts = exportBundleFromRoot(root, "parity");
  if (!ts.ok) throw new Error(ts.reason);
  const tsText = serializeBundle(ts.bundle);
  const out = join(root, "rust-bundle.json");
  const rs = await run([RUST_BIN, "export", "--dir", root, "--project", "parity", "--no-attest", "--out", out]);
  expect(rs.code).toBe(0);
  expect(readFileSync(out, "utf8")).toBe(tsText);
  // What the policy did is visible in the bytes both sides produced.
  expect(tsText).toContain('"withheldFields": [\n            "detail"\n          ]');
  expect(tsText).toContain('"withheldPayload": true');
  expect(tsText).not.toContain("/Users/u/");
  expect(tsText).not.toContain("/tmp/private");
});

// 128 FR-006: policy version 6's scan for a URL carrying userinfo is one rule
// in two languages, so both exports of a chain holding such URLs, in a leaf
// field, inside prose and inside a command argument, are the same bytes, and
// neither carries the token.
test("FR-003 (c), 128 FR-006: at policy 6 both exports withhold a credentialed URL identically", async () => {
  const root = fresh();
  const token = "ghp_fabricated128parity";
  const work = openJournal(root);
  try {
    work.append("acceptance.receipt", {
      schemaVersion: 1,
      repo: { origin: `https://x-access-token:${token}@github.com/o/r.git`, branch: "128-x" },
      suite: { commands: [["git", "ls-remote", `https://u:${token}@github.com/o/r.git`]], digest: "d" },
      passing: true,
    });
    work.append("run.result", { status: "completed", note: `pushed to HTTPS://${token}@github.com/o/r`, plain: "https://github.com/o/r" });
  } finally {
    work.close();
  }
  openJournal(root, "decisions").close();
  const ts = exportBundleFromRoot(root, "parity");
  if (!ts.ok) throw new Error(ts.reason);
  expect(ts.bundle.policyVersion).toBe(6);
  const tsText = serializeBundle(ts.bundle);
  const out = join(root, "rust-bundle.json");
  const rs = await run([RUST_BIN, "export", "--dir", root, "--project", "parity", "--no-attest", "--out", out]);
  expect(rs.code).toBe(0);
  expect(readFileSync(out, "utf8")).toBe(tsText);
  expect(tsText).not.toContain(token);
  expect(tsText).toContain('"plain": "https://github.com/o/r"');
}, 600_000);

test("FR-003 (d): the two verifiers agree on where a tampered bundle first breaks", async () => {
  const root = fresh();
  writeChainWithTypescript(root);
  const ts = exportBundleFromRoot(root, null);
  if (!ts.ok) throw new Error(ts.reason);
  const text = serializeBundle(ts.bundle);
  const tampered = text.replace('"outcome": "passed"', '"outcome": "failed"');
  expect(tampered).not.toBe(text);
  const path = join(root, "tampered.json");
  writeFileSync(path, tampered);
  const parsed = parseBundle(tampered);
  if (!parsed.ok) throw new Error(parsed.reason);
  const tsVerdict = verifyBundle(parsed.bundle);
  const rs = await run([RUST_BIN, "verify-bundle", path, "--json"]);
  expect(rs.code).toBe(1);
  const envelope = JSON.parse(rs.stdout) as { ok: boolean; error: { message: string } };
  expect(envelope.ok).toBe(false);
  expect(tsVerdict).toEqual({ ok: false, chain: "work", seq: 4, reason: "included payload does not match its payload hash" });
  expect(envelope.error.message).toContain("work: BROKEN at seq 4: included payload does not match its payload hash");
});

test("FR-004: the manifest parses through the contract shape", async () => {
  const manifest = await run([RUST_BIN, "--member-manifest"]);
  expect(manifest.code).toBe(0);
  const parsed = JSON.parse(manifest.stdout) as { name: string; contract: string; verbs: string[]; capabilityTier: string };
  expect(parsed).toMatchObject({
    name: "statecraft-journal",
    contract: "042",
    verbs: ["verify", "verify-bundle", "export"],
    capabilityTier: "basic",
  });
});
