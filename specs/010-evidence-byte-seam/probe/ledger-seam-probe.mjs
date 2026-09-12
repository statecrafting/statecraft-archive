// Characterization probe for governance-native's ledger seam (spec 010).
//
// Usage: node ledger-seam-probe.mjs <addon.node> <evidence-bytes.v1.json> <work-dir> [report.json]
//
// Drives the addon's JavaScript surface, the one statecraft calls, with the
// evidence-byte vectors. For every vector it reports four things separately:
// whether the stored payload kept the submitted bytes, whether SHA-256 of
// what was stored equals the declared digest, what envelope id the ledger
// derived (metadata), and whether ledgerVerify accepts the chain. It then
// mutates stored bytes in ways that keep the parsed model and asks
// ledgerVerify whether it notices.
//
// It asserts nothing about the addon. It exits 0 unless the probe itself
// fails, and it records what happens. It writes under <work-dir>, plus the
// report file when one is named. Every vector the addon appends must be a
// JSON object: the stored-payload extraction below depends on it, and the
// probe stops rather than report a result it cannot read.

import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const [addonPath, vectorsPath, workDir, reportPath] = process.argv.slice(2);
if (!addonPath || !vectorsPath || !workDir) {
  console.error("usage: node ledger-seam-probe.mjs <addon.node> <evidence-bytes.v1.json> <work-dir> [report.json]");
  process.exit(3);
}
const addon = createRequire(import.meta.url)(resolve(addonPath));
const { vectors } = JSON.parse(readFileSync(vectorsPath, "utf8"));

const sha = (buf) => "sha256:" + createHash("sha256").update(buf).digest("hex");

// RFC 8785 comparison only: keys by UTF-16 code unit (the default JS sort),
// primitives by ECMAScript JSON.stringify.
const jcs = (v) =>
  v === null || typeof v !== "object"
    ? JSON.stringify(v)
    : Array.isArray(v)
      ? `[${v.map(jcs).join(",")}]`
      : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${jcs(v[k])}`).join(",")}}`;

const fresh = (name) => {
  const dir = join(workDir, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
};

// A stored line is serde's struct order: id, timestamp,
// previous_record_hash, record_hash, payload. The payload is the tail, and
// dropping the line's last byte leaves it whole only when it is an object.
const lastLine = (dir) => {
  const lines = readFileSync(join(dir, "records.jsonl"), "utf8").split("\n").filter(Boolean);
  return lines[lines.length - 1];
};
const storedPayload = (line) => {
  const payload = JSON.parse(line).payload;
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("probe reads object payloads only; an appended vector must be a JSON object");
  }
  return Buffer.from(line.slice(line.indexOf('"payload":') + '"payload":'.length, -1), "utf8");
};

const attempt = (fn) => {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
};

const results = [];
for (const v of vectors) {
  const bytes = Buffer.from(v.bytesBase64, "base64");
  const r = { id: v.id, class: v.class };
  r.fixtureDigestHolds = sha(bytes) === v.declaredDigest;

  // The seam's type: can a JS string carry these bytes to a napi String?
  const text = bytes.toString("utf8");
  r.stringSurfaceLossless = Buffer.from(text, "utf8").equals(bytes);

  // A. The document submitted as the record itself.
  const dirA = fresh(`${v.id}-A`);
  const a = attempt(() => addon.ledgerAppend(dirA, text));
  if (!a.ok) {
    r.recordPath = { outcome: "refused", error: a.error };
  } else {
    const line = lastLine(dirA);
    const stored = storedPayload(line);
    // Append the stored form to its own fresh chain: an equal record hash
    // for distinct bytes means the chain cannot tell the two apart.
    const dirS = fresh(`${v.id}-S`);
    const s = addon.ledgerAppend(dirS, stored.toString("utf8"));
    r.recordPath = {
      outcome: "appended",
      recordHash: a.value.recordHash,
      bytesPreserved: stored.equals(bytes),
      storedPayload: stored.toString("utf8").slice(0, 160),
      storedDigestEqualsDeclared: sha(stored) === v.declaredDigest,
      distinctBytesSameRecordHash: !stored.equals(bytes) && s.recordHash === a.value.recordHash,
      envelopeId: JSON.parse(line).id,
      chainVerifies: addon.ledgerVerify(dirA).ok,
    };
  }

  // B. statecraft's backend/governance/records.ts shape (statecraft main
  //    9658e29): payloadHash = canonicalize(JSON.stringify(payload)).sha256,
  //    then ledgerAppend(JSON.stringify(envelope)). JSON.parse stands in for
  //    the framework's request-body parse, which this probe does not run.
  const parsed = attempt(() => JSON.parse(text));
  if (!parsed.ok) {
    r.recordsTsPath = { outcome: "refused-by-JSON.parse", error: parsed.error };
  } else {
    const dirB = fresh(`${v.id}-B`);
    const b = attempt(() => {
      const payloadHash = addon.canonicalize(JSON.stringify(parsed.value)).sha256;
      const envelope = {
        id: v.id,
        timestamp: "",
        kind: "evidence",
        subject: "probe",
        subjectIds: [],
        actor: "probe",
        payloadHash,
        payload: parsed.value,
      };
      addon.ledgerAppend(dirB, JSON.stringify(envelope));
      return payloadHash;
    });
    if (!b.ok) {
      r.recordsTsPath = { outcome: "refused", error: b.error };
    } else {
      // Re-stringified only to compare with the submitted bytes.
      const inner = Buffer.from(JSON.stringify(JSON.parse(lastLine(dirB)).payload.payload), "utf8");
      r.recordsTsPath = {
        outcome: "appended",
        bytesPreserved: inner.equals(bytes),
        payloadHashEqualsDeclared: "sha256:" + b.value === v.declaredDigest,
        chainVerifies: addon.ledgerVerify(dirB).ok,
      };
    }
  }

  // The canonical forms a digest-over-canonical-form pipeline would give.
  const c = attempt(() => addon.canonicalize(text));
  r.keysortCanonical = c.ok
    ? { canonical: c.value.canonical.slice(0, 160), digestEqualsDeclared: "sha256:" + c.value.sha256 === v.declaredDigest }
    : { outcome: "refused", error: c.error };
  r.jcsComparison = parsed.ok && c.ok
    ? { canonical: jcs(parsed.value).slice(0, 160), equalsKeysort: c.value.canonical === jcs(parsed.value) }
    : { outcome: "n/a" };

  results.push(r);
}

// Pairs of distinct submissions.
const byId = Object.fromEntries(results.map((r) => [r.id, r]));
const digestOf = Object.fromEntries(vectors.map((v) => [v.id, v.declaredDigest]));
const pairKeys = [...new Set(vectors.filter((v) => v.pairWith).map((v) => [v.id, v.pairWith].sort().join("\n")))];
const pairs = pairKeys.map((key) => {
  const [x, y] = key.split("\n");
  const a = byId[x].recordPath, b = byId[y].recordPath;
  return {
    pair: `${x} / ${y}`,
    distinctDeclaredDigests: digestOf[x] !== digestOf[y],
    equalRecordHash: a.recordHash !== undefined && a.recordHash === b.recordHash,
  };
});

// Mutations of stored bytes, each on a copy of the same two-record chain.
const base = fresh("mutation-base");
addon.ledgerAppend(base, '{"id":"x","kind":"stamp"}');
addon.ledgerAppend(base, '{"id":"y","kind":"evidence","big":12345678901234567890123}');
const baseFile = readFileSync(join(base, "records.jsonl"), "utf8");

const mutations = [
  { id: "M01-whitespace", note: 'insert a space after "payload":', from: '"payload":{"id":"x"', to: '"payload": {"id":"x"' },
  { id: "M02-duplicate-key-injection", note: 'inject "kind":"forged" before the real kind', from: '"kind":"stamp"', to: '"kind":"forged","kind":"stamp"' },
  { id: "M03-number-respelling", note: "respell the stored float as the original integer literal", from: /1\.2345678901234568e\+?22/, to: "12345678901234567890123" },
  { id: "M04-escape-respelling", note: "respell stamp as st\\u0061mp", from: '"stamp"', to: '"st\\u0061mp"' },
  { id: "M05-key-reorder", note: "reorder keys inside the first payload", from: '{"id":"x","kind":"stamp"}', to: '{"kind":"stamp","id":"x"}' },
  { id: "M06-control-value-change", note: "positive control: change the value stamp to stamq", from: '"stamp"', to: '"stamq"' },
];
// A string pattern is literal in both the existence check and the edit.
const found = (from) => (from instanceof RegExp ? from.test(baseFile) : baseFile.includes(from));
const mutationResults = mutations.map((m) => {
  if (!found(m.from)) return { id: m.id, error: `pattern not found: ${m.from}` };
  const dir = fresh(m.id);
  cpSync(base, dir, { recursive: true });
  const mutated = baseFile.replace(m.from, m.to);
  writeFileSync(join(dir, "records.jsonl"), mutated);
  const verdict = addon.ledgerVerify(dir);
  return {
    id: m.id,
    note: m.note,
    storedBytesChanged: mutated !== baseFile,
    verifyOk: verdict.ok,
    verifyError: verdict.error ?? null,
  };
});

const report = { probe: "statecrafting spec 010, evidence-bytes/v1", node: process.version, vectors: results, pairs, mutations: mutationResults };
if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");

const yn = (x) => (x === undefined ? "-" : x ? "yes" : "NO");
const row = (cells) => console.log(`| ${cells.join(" | ")} |`);
console.log(`node ${process.version}\n\nA. submitted as the record\n`);
row(["vector", "string seam lossless", "outcome", "bytes kept", "stored digest = declared", "same hash as stored form", "envelope id", "verifies"]);
for (const r of results) {
  const a = r.recordPath;
  row([r.id, yn(r.stringSurfaceLossless), a.outcome === "appended" ? "appended" : `refused: ${a.error}`,
    yn(a.bytesPreserved), yn(a.storedDigestEqualsDeclared), yn(a.distinctBytesSameRecordHash), a.envelopeId ?? "-", yn(a.chainVerifies)]);
}
console.log("\nB. statecraft records.ts envelope, and canonical forms\n");
row(["vector", "outcome", "bytes kept", "payloadHash = declared", "keysort digest = declared", "keysort = RFC 8785 order and numbers"]);
for (const r of results) {
  const b = r.recordsTsPath;
  row([r.id, b.outcome === "appended" ? "appended" : `${b.outcome}: ${b.error}`, yn(b.bytesPreserved), yn(b.payloadHashEqualsDeclared),
    r.keysortCanonical.outcome ? "refused" : yn(r.keysortCanonical.digestEqualsDeclared), r.jcsComparison.outcome ?? yn(r.jcsComparison.equalsKeysort)]);
}
console.log("\nPairs\n");
row(["pair", "distinct declared digests", "equal record hash"]);
for (const p of pairs) row([p.pair, yn(p.distinctDeclaredDigests), yn(p.equalRecordHash)]);
console.log("\nMutations of stored bytes\n");
row(["mutation", "stored bytes changed", "ledgerVerify ok", "error"]);
for (const m of mutationResults) row([m.id, yn(m.storedBytesChanged), yn(m.verifyOk), m.verifyError ?? m.error ?? ""]);
