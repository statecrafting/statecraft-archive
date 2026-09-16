// Spec 112 FR-003: the Rust sensor and the TypeScript sensor, run over the
// same store with the same arguments, write byte-identical stdout. The
// TypeScript sensor keeps its store under its project directory, so the
// source tree is copied to a temp directory and the store seeded there; the
// Rust sensor is pointed at the same store through STATECRAFT_SENSOR_DATA_DIR.
// The Rust binary is built here so the check cannot pass against a stale one
// (D-5). Both sides run under TZ=UTC and NO_COLOR=1 with HOME redirected to
// a fixture home, so `peek` and the state-file display resolve the same way.
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const REPO = join(import.meta.dir, "..", "..", "..");
const MEMBERS = join(REPO, "members");
const RUST_BIN = join(REPO, "target", "debug", "statecraft-sensor-claude");

const SESSION = "0123abcd-1111-2222-3333-444444444444";

interface Fixture {
  readonly root: string;
  readonly srcEntry: string;
  readonly dataDir: string;
  readonly home: string;
  readonly findings: string;
}

function seed(dataDir: string): void {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "observatory.db"), { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, path TEXT NOT NULL, action TEXT NOT NULL,
      entry_kind TEXT, kind TEXT NOT NULL, label TEXT NOT NULL, size_before INTEGER, size_after INTEGER,
      delta INTEGER, inode INTEGER, raw TEXT);
    CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT, taken_at INTEGER NOT NULL, entry_count INTEGER);
    CREATE TABLE IF NOT EXISTS snapshot_entries (snapshot_id INTEGER NOT NULL, path TEXT NOT NULL, kind TEXT, size INTEGER, mtime_ms INTEGER, mode INTEGER, inode INTEGER);
  `);
  const now = Date.now();
  const ins = db.query(
    `INSERT INTO events (ts, path, action, entry_kind, kind, label, size_before, size_after, delta, inode, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const rows: [number, string, string, string, string, string, number | null, number | null, number | null, number | null, string | null][] = [
    [now - 5_000_000, `projects/p/${SESSION}.jsonl`, "created", "file", "transcript", `new transcript for session 0123abcd in p`, null, 10, 10, 41, JSON.stringify([{ ts: now - 5_000_010, type: "create" }])],
    [now - 4_000_000, `projects/p/${SESSION}.jsonl`, "modified", "file", "transcript", `transcript grew: session 0123abcd (p)`, 10, 1510, 1500, 41, null],
    [now - 3_000_000, "~/.claude.json", "replaced", "file", "state-file", "state file rewritten (atomic replace)", 2048, 2049, 1, 99, JSON.stringify([{ ts: now - 3_000_100, type: "rename" }, { ts: now - 3_000_050, type: "change" }])],
    [now - 2_000_000, "settings.json", "modified", "file", "config", "USER CONFIG modified: settings.json", 300, 2_500_000, 2_499_700, 7, null],
    [now - 1_000_000, "history.jsonl", "modified", "file", "prompt-history", "global prompt history SHRANK", 900, 100, -800, 8, null],
    [now - 500_000, "something/odd", "created", "dir", "unclassified", "UNCLASSIFIED: something/odd created (dir)", null, 0, 0, 9, null],
    [now - 100_000, `projects/p/${SESSION}.jsonl`, "deleted", "file", "transcript", `transcript deleted: session 0123abcd in p`, 1510, null, -1510, 41, null],
  ];
  for (const r of rows) ins.run(...r);
  const snap = db.query(`INSERT INTO snapshots (label, taken_at, entry_count) VALUES (?, ?, ?)`);
  const entry = db.query(`INSERT INTO snapshot_entries (snapshot_id, path, kind, size, mtime_ms, mode, inode) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  snap.run("before", now - 6_000_000, 3);
  entry.run(1, ".", "dir", 0, 1, 493, 1);
  entry.run(1, "settings.json", "file", 300, 2, 420, 7);
  entry.run(1, "history.jsonl", "file", 900, 3, 420, 8);
  snap.run("after", now - 50_000, 4);
  entry.run(2, ".", "dir", 0, 1, 493, 1);
  entry.run(2, "settings.json", "file", 2_500_000, 4, 420, 7);
  entry.run(2, "history.jsonl", "file", 900, 3, 420, 80);
  entry.run(2, "something/odd", "dir", 0, 5, 493, 9);
  db.close();
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "sensor-parity-"));
  // The TypeScript sensor: its project directory is the copied tree, so its
  // store lands under <root>/ts/data and FINDINGS.md beside src/.
  const ts = join(root, "ts");
  cpSync(join(MEMBERS, "src"), join(ts, "src"), { recursive: true });
  cpSync(join(MEMBERS, "package.json"), join(ts, "package.json"));
  cpSync(join(MEMBERS, "tsconfig.json"), join(ts, "tsconfig.json"));
  const findings = join(ts, "FINDINGS.md");
  writeFileSync(
    findings,
    [
      "# Findings",
      "",
      "intro",
      "",
      "## `projects/<slug>/<uuid>.jsonl`",
      "",
      "A session transcript, appended per turn.",
      "",
      "### detail",
      "",
      "more",
      "",
      "## `settings.json`",
      "",
      "User configuration.",
      "",
    ].join("\n")
  );
  const dataDir = join(ts, "data");
  seed(dataDir);
  // A fixture home so `peek` reads a known file from ~/.claude.
  const home = join(root, "home");
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(join(home, ".claude", "settings.json"), '{"apiKey": "sk-ant-abcdefghijkl", "theme": "dark"}\n');
  writeFileSync(join(home, ".claude.json"), "{}\n");
  chmodSync(join(home, ".claude", "settings.json"), 0o644);
  return { root, srcEntry: join(ts, "src", "index.ts"), dataDir, home, findings };
}

interface Ran {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function run(cmd: readonly string[], env: Record<string, string>): Promise<Ran> {
  const proc = Bun.spawn([...cmd], {
    cwd: REPO,
    stdout: "pipe",
    stderr: "pipe",
    env: { PATH: process.env.PATH ?? "", TZ: "UTC", NO_COLOR: "1", ...env },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

const CASES: readonly (readonly string[])[] = [
  ["log"],
  ["log", "--since", "2h"],
  ["log", "--kind", "transcript"],
  ["log", "--action", "modified", "--limit", "2"],
  ["log", "--path", "projects/*"],
  ["log", "--raw"],
  ["stats"],
  ["stats", "--since", "1h"],
  ["snapshot", "--list"],
  ["diff", "1", "2"],
  ["explain", `projects/p/${SESSION}.jsonl`],
  ["explain", "settings.json"],
  ["explain", "nothing/here"],
  ["peek", "settings.json"],
  ["peek", "settings.json", "--bytes", "10", "--tail"],
  ["daemon", "status"],
  ["nonesuch"],
];

test("the Rust sensor builds", async () => {
  const built = await run(["cargo", "build", "-p", "statecraft-sensor-claude"], { HOME: process.env.HOME ?? "" });
  expect(built.code).toBe(0);
}, 600_000);

test("FR-003: every read verb is byte-identical between the TypeScript and Rust sensors", async () => {
  const fx = fixture();
  for (const args of CASES) {
    const ts = await run(["bun", fx.srcEntry, ...args], { HOME: fx.home });
    const rs = await run([RUST_BIN, ...args], {
      HOME: fx.home,
      STATECRAFT_SENSOR_DATA_DIR: fx.dataDir,
      STATECRAFT_SENSOR_FINDINGS: fx.findings,
    });
    expect({ args, code: rs.code, stdout: rs.stdout, stderr: rs.stderr }).toEqual({
      args,
      code: ts.code,
      stdout: ts.stdout,
      stderr: ts.stderr,
    });
  }
}, 120_000);

test("FR-004: the Rust manifest equals spec 111's sensor fixture modulo version", async () => {
  const rs = await run([RUST_BIN, "--member-manifest"], {});
  expect(rs.code).toBe(0);
  const manifest = JSON.parse(rs.stdout) as { version: string };
  const fixtureManifest = JSON.parse(
    await Bun.file(join(REPO, "crates", "statecraft-contract", "fixtures", "manifest-sensor.json")).text()
  ) as { version: string };
  expect({ ...manifest, version: fixtureManifest.version }).toEqual(fixtureManifest);
});
