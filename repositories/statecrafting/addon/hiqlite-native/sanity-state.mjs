// Round-trip check for the STATE LAYER surface (enrahitu spec 032), no Encore
// involved. Usage: node sanity-state.mjs (after `npm run build`).
//
// This exercises every contract decision that produced a call, and the two
// that produced a behavior rather than a call (txn atomicity, fencing).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.ENRAHITU_HIQ_DATA_DIR = mkdtempSync(join(tmpdir(), "hiq-state-"));
process.env.ENRAHITU_HIQ_ADDR_RAFT = "127.0.0.1:8391";
process.env.ENRAHITU_HIQ_ADDR_API = "127.0.0.1:8491";

const hiqlite = (await import("./index.js")).default;
let failures = 0;
const check = (name, cond, detail = "") => {
  if (cond) console.log(`  ok   ${name}`);
  else { console.log(`  FAIL ${name} ${detail}`); failures++; }
};

await hiqlite.init();
console.log("health:", await hiqlite.health());

console.log("\n-- replicated SQL --");
await hiqlite.execute(
  "CREATE TABLE IF NOT EXISTS member (id TEXT PRIMARY KEY, name TEXT, dues REAL, active INTEGER, note TEXT)",
);
const n = await hiqlite.execute(
  "INSERT INTO member (id, name, dues, active, note) VALUES ($1, $2, $3, $4, $5)",
  ["m1", "Ada Lovelace", 42.5, 1, null],
);
check("execute returns rows affected", n === 1, `got ${n}`);

const rows = await hiqlite.query("SELECT * FROM member WHERE id = $1", ["m1"]);
check("query returns a flat row object", rows.length === 1 && rows[0].id === "m1", JSON.stringify(rows));
check("TEXT round-trips", rows[0].name === "Ada Lovelace");
check("REAL round-trips", rows[0].dues === 42.5, `got ${rows[0].dues}`);
check("INTEGER round-trips", rows[0].active === 1);
check("NULL round-trips as null", rows[0].note === null, `got ${JSON.stringify(rows[0].note)}`);

const consistent = await hiqlite.queryConsistent("SELECT COUNT(*) AS c FROM member");
check("queryConsistent reads through the leader", consistent[0].c === 1, JSON.stringify(consistent));

console.log("\n-- txn: the atomic unit (decision 1) --");
await hiqlite.execute("CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY, topic TEXT)");
const res = await hiqlite.txn([
  { sql: "INSERT INTO member (id, name) VALUES ($1, $2)", params: ["m2", "Grace Hopper"] },
  { sql: "INSERT INTO outbox (topic) VALUES ($1)", params: ["member.created"] },
]);
check("txn returns per-statement rows affected", JSON.stringify(res) === "[1,1]", JSON.stringify(res));
const both = await hiqlite.queryConsistent("SELECT (SELECT COUNT(*) FROM member) AS m, (SELECT COUNT(*) FROM outbox) AS o");
check("resource and outbox both committed", both[0].m === 2 && both[0].o === 1, JSON.stringify(both));

let threw = false;
try {
  await hiqlite.txn([
    { sql: "INSERT INTO member (id, name) VALUES ($1, $2)", params: ["m3", "Ok"] },
    { sql: "INSERT INTO member (id, name) VALUES ($1, $2)", params: ["m1", "duplicate pk"] },
  ]);
} catch (e) { threw = true; }
check("a failing statement fails the whole txn", threw);
const after = await hiqlite.queryConsistent("SELECT COUNT(*) AS c FROM member");
check("failed txn left no partial write", after[0].c === 2, `got ${after[0].c}`);

console.log("\n-- CAS via unique index (decision 7: no new primitive) --");
await hiqlite.execute("CREATE TABLE IF NOT EXISTS chain (id TEXT PRIMARY KEY, parent TEXT UNIQUE)");
await hiqlite.execute("INSERT INTO chain (id, parent) VALUES ('genesis', NULL)");
await hiqlite.execute("INSERT INTO chain (id, parent) VALUES ('d1', 'genesis')");
let casRejected = false;
try { await hiqlite.execute("INSERT INTO chain (id, parent) VALUES ('d2', 'genesis')"); }
catch (e) { casRejected = true; }
check("a second writer claiming the same parent is rejected", casRejected);

console.log("\n-- leases and fencing (decision 4) --");
const lease1 = await hiqlite.lock("reconcile:members");
check("lock returns a fencing token", typeof lease1.token === "number", JSON.stringify(lease1));
await hiqlite.releaseLock("reconcile:members");
const lease2 = await hiqlite.lock("reconcile:members");
check("the token is monotonic across holders", lease2.token > lease1.token, `${lease1.token} -> ${lease2.token}`);
await hiqlite.releaseLock("reconcile:members");
const other = await hiqlite.lock("reconcile:events");
check("a different key has its own fence", other.token === 1, `got ${other.token}`);
await hiqlite.releaseLock("reconcile:events");

console.log("\n-- watch (decisions 2 and 10) --");
const received = hiqlite.listenNext();
await hiqlite.notify({ kind: "Member", tenant: "t1", name: "m1", revision: 7 });
const evt = await Promise.race([received, new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 5000))]);
check("notify delivers the key-only envelope", evt.kind === "Member" && evt.revision === 7, JSON.stringify(evt));

console.log("\n-- durability (decision 8) --");
await hiqlite.backup();
const backups = await hiqlite.backupListLocal();
check("backup() produces a listable local backup", backups.length >= 1, JSON.stringify(backups));

console.log("\n-- refusals that must stay refusals --");
let blobErr = "";
try { await hiqlite.query("SELECT CAST('x' AS BLOB) AS b"); } catch (e) { blobErr = String(e.message ?? e); }
check("a BLOB column errors rather than mis-encoding", blobErr.includes("BLOB"), blobErr);
let objErr = "";
try { await hiqlite.execute("SELECT $1", [{ nested: true }]); } catch (e) { objErr = String(e.message ?? e); }
check("an object parameter is refused", objErr.includes("not SQL values"), objErr);

console.log(failures === 0 ? "\nsanity-state: PASS" : `\nsanity-state: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
