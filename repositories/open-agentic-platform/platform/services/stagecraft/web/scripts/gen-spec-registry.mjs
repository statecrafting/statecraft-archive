// Governed projection: build-time snapshots of OAP's own spec registry for the
// public Registry pages. Reads through the `spec-spine registry` consumer
// binary (never the raw .derived shards), so it honors the governed-reads
// contract. The per-spec body excerpt is read from the authored spec.md source
// (not a .derived artifact). Regenerate from anywhere:
//
//   node platform/services/statecraft/web/scripts/gen-spec-registry.mjs
//
// Emits two files under app/lib/ (both committed; refresh per deploy so the
// public pages never silently drift from the compiled corpus):
//   - spec-registry.generated.json : lean list (table / graph / dashboard)
//   - spec-details.generated.json  : rich per-spec detail (detail route only)

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_LIB = join(SCRIPT_DIR, "..", "app", "lib");
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..", "..", "..", "..");

// Normalise U+2014 (em dash) in projected prose to a colon; it reads as an AI
// tell in committed text. Built from an escape so this source stays clean.
const EM_DASH = new RegExp("\\s*\\u2014\\s*", "g");
function stripEmDash(s) {
  return typeof s === "string" ? s.replace(EM_DASH, ": ") : s;
}

function numFromId(id) {
  const m = /^(\d{3,})/.exec(id);
  return m ? m[1] : "";
}

function truncate(s, n) {
  if (!s) return "";
  const t = stripEmDash(s).trim();
  return t.length > n ? `${t.slice(0, n).trimEnd()}...` : t;
}

function unitLabel(unit) {
  if (!unit || typeof unit !== "object") return String(unit ?? "");
  if (typeof unit.path === "string") return unit.path;
  if (typeof unit.id === "string") return unit.id;
  return JSON.stringify(unit);
}

// Governed read through the consumer binary.
const raw = execFileSync("spec-spine", ["registry", "list", "--json"], {
  cwd: REPO_ROOT,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
const records = JSON.parse(raw);

const titleById = new Map(records.map((r) => [r.id, stripEmDash(r.title)]));
const createdById = new Map(records.map((r) => [r.id, r.created ?? ""]));
const idByPrefix = new Map();
for (const r of records) {
  const p = numFromId(r.id);
  if (p && !idByPrefix.has(p)) idByPrefix.set(p, r.id);
}
function normId(x) {
  if (titleById.has(x)) return x;
  const m = /^(\d{3,})/.exec(String(x));
  if (m && idByPrefix.has(m[1])) return idByPrefix.get(m[1]);
  return x;
}
function ref(idOrPrefix) {
  const id = normId(idOrPrefix);
  return { id, title: titleById.get(id) ?? id };
}

// A relationship target can be a bare id string or an object carrying a `spec`.
function targetsOf(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const v of value) {
    if (typeof v === "string") out.push(v);
    else if (v && typeof v === "object" && typeof v.spec === "string") out.push(v.spec);
  }
  return out;
}

function readBodyExcerpt(specPath, limit) {
  if (!specPath) return { text: "", truncated: false };
  try {
    let txt = readFileSync(join(REPO_ROOT, specPath), "utf8");
    txt = txt.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n/, ""); // strip frontmatter
    txt = txt.replace(/^\s*#[^\n]*\n/, ""); // strip leading H1
    txt = stripEmDash(txt).replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
    if (txt.length > limit) return { text: `${txt.slice(0, limit).trimEnd()}...`, truncated: true };
    return { text: txt, truncated: false };
  } catch {
    return { text: "", truncated: false };
  }
}

// --- Lean list projection + graph edges -------------------------------------
const counts = { status: {}, implementation: {}, domain: {}, kind: {} };
const bump = (b, k) => {
  if (k == null) return;
  b[k] = (b[k] ?? 0) + 1;
};

const specs = [];
const edges = [];
const ids = new Set(records.map((r) => r.id));

// Reverse "who depends on this spec" adjacency for impact analysis.
const incoming = new Map(); // targetId -> [{ id, title, type }]
const addIncoming = (target, source, type) => {
  const t = normId(target);
  if (!ids.has(t) || t === source) return;
  if (!incoming.has(t)) incoming.set(t, []);
  incoming.get(t).push({ id: source, title: titleById.get(source) ?? source, type });
};

for (const r of records) {
  bump(counts.status, r.status);
  bump(counts.implementation, r.implementation);
  bump(counts.domain, r.domain);
  bump(counts.kind, r.kind);

  const tags = [...new Set([r.domain, r.kind].filter(Boolean))];
  specs.push({
    id: r.id,
    num: numFromId(r.id),
    title: stripEmDash(r.title),
    status: r.status ?? "unknown",
    implementation: r.implementation ?? "n-a",
    kind: r.kind ?? "unknown",
    domain: r.domain ?? "unknown",
    created: r.created ?? "",
    tags,
    summary: truncate(r.summary, 360),
  });

  for (const [field, type] of [
    ["amends", "amends"],
    ["supersedes", "supersedes"],
    ["extends", "extends"],
  ]) {
    for (const target of targetsOf(r[field])) {
      if (ids.has(normId(target)) && normId(target) !== r.id) {
        edges.push({ source: r.id, target: normId(target), type });
      }
    }
  }

  // Reverse edges for dependents (broader than the graph edge set).
  for (const [field, type] of [
    ["amends", "amends"],
    ["supersedes", "supersedes"],
    ["extends", "extends"],
    ["dependsOn", "dependsOn"],
  ]) {
    for (const target of targetsOf(r[field])) addIncoming(target, r.id, type);
  }
  for (const c of Array.isArray(r.constrains) ? r.constrains : []) {
    for (const t of Array.isArray(c?.target_specs) ? c.target_specs : []) {
      addIncoming(t, r.id, "constrains");
    }
  }
}

specs.sort((a, b) => a.id.localeCompare(b.id));

// Transitive dependents: reverse BFS over `incoming`.
function transitiveDependentCount(startId) {
  const seen = new Set();
  const queue = [startId];
  while (queue.length) {
    const cur = queue.shift();
    for (const dep of incoming.get(cur) ?? []) {
      if (!seen.has(dep.id) && dep.id !== startId) {
        seen.add(dep.id);
        queue.push(dep.id);
      }
    }
  }
  return seen.size;
}

const byId = new Map(records.map((r) => [r.id, r]));

// --- Rich per-spec detail projection ----------------------------------------
const details = {};
for (const r of records) {
  const extra = r.extraFrontmatter && typeof r.extraFrontmatter === "object" ? r.extraFrontmatter : {};

  // `amendmentRecord` is either a spec id or a free-text note; disambiguate.
  // Require the WHOLE token to be an id form (digits, optionally `-slug`) so a
  // note phrased like "175 (self): ..." is not misread as spec 175.
  const amRec = typeof r.amendmentRecord === "string" ? r.amendmentRecord.trim() : "";
  const amRecIsSpec =
    /^\d{3,}(-[\w-]+)?$/.test(amRec) && titleById.has(normId(amRec));
  const amendedBy = amRecIsSpec ? ref(amRec) : null;
  const amendmentNote = amRec !== "" && !amRecIsSpec ? stripEmDash(amRec) : "";

  // Real lifecycle timeline from authored dates (no fabricated revisions).
  const timeline = [];
  if (r.created) timeline.push({ date: r.created, type: "created", label: "Spec authored" });
  if (typeof extra.amended === "string") {
    const by = amendedBy ? ` by ${amendedBy.id}` : "";
    timeline.push({ date: extra.amended, type: "amended", label: `Amended${by}` });
  }
  if (typeof extra.closed === "string") {
    timeline.push({ date: extra.closed, type: "closed", label: "Closed" });
  }
  if (typeof r.supersededBy === "string") {
    const succ = normId(r.supersededBy);
    timeline.push({
      date: createdById.get(succ) || extra.closed || r.created || "",
      type: "superseded",
      label: `Superseded by ${succ}`,
    });
  }
  timeline.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const inbound = incoming.get(r.id) ?? [];
  const directDependents = [...new Map(inbound.map((d) => [d.id, d])).values()].map((d) => ({
    id: d.id,
    title: d.title,
  }));

  // Related specs scored by shared-tag overlap (tags = [domain, kind]), top 6.
  const curTags = new Set([r.domain, r.kind].filter(Boolean));
  const related = specs
    .filter((s) => s.id !== r.id)
    .map((s) => ({ s, shared: s.tags.filter((t) => curTags.has(t)) }))
    .filter((x) => x.shared.length > 0)
    .sort((a, b) => b.shared.length - a.shared.length || a.s.id.localeCompare(b.s.id))
    .slice(0, 6)
    .map((x) => ({
      id: x.s.id,
      num: x.s.num,
      title: x.s.title,
      status: x.s.status,
      sharedTags: x.shared,
    }));

  const body = readBodyExcerpt(r.specPath, 1600);

  details[r.id] = {
    id: r.id,
    num: numFromId(r.id),
    title: stripEmDash(r.title),
    status: r.status ?? "unknown",
    implementation: r.implementation ?? "n-a",
    kind: r.kind ?? "unknown",
    domain: r.domain ?? "unknown",
    created: r.created ?? "",
    owner: r.owner ?? "",
    risk: r.risk ?? "",
    slug: typeof extra.slug === "string" ? extra.slug : "",
    dates: {
      amended: typeof extra.amended === "string" ? extra.amended : "",
      closed: typeof extra.closed === "string" ? extra.closed : "",
    },
    summary: stripEmDash(r.summary ?? ""),
    specPath: r.specPath ?? "",
    codeAliases: Array.isArray(r.codeAliases) ? r.codeAliases : [],
    sectionHeadings: (Array.isArray(r.sectionHeadings) ? r.sectionHeadings : []).map(stripEmDash),
    establishes: (Array.isArray(r.establishes) ? r.establishes : []).map((e) => ({
      kind: e?.kind ?? "path",
      path: e?.path ?? unitLabel(e),
    })),
    extendsSpecs: (Array.isArray(r.extends) ? r.extends : [])
      .filter((e) => e?.spec)
      .map((e) => ({ ...ref(e.spec), nature: e.nature ?? "" })),
    refines: (Array.isArray(r.refines) ? r.refines : []).map((e) => ({
      aspect: e?.aspect ?? "",
      unit: unitLabel(e?.unit),
    })),
    amendsSpecs: targetsOf(r.amends).map(ref),
    supersedesSpecs: targetsOf(r.supersedes).map(ref),
    supersededBy: typeof r.supersededBy === "string" ? ref(r.supersededBy) : null,
    amendedBy,
    amendmentNote,
    timeline,
    dependsOnSpecs: targetsOf(r.dependsOn).map(ref),
    constrains: (Array.isArray(r.constrains) ? r.constrains : []).map((c) => ({
      kind: c?.kind ?? "",
      targets: (Array.isArray(c?.target_specs) ? c.target_specs : []).map(ref),
    })),
    references: (Array.isArray(r.references) ? r.references : []).map((rf) => ({
      unit: unitLabel(rf?.unit),
      role: rf?.role ?? "",
    })),
    incoming: inbound,
    directDependents,
    transitiveDependentCount: transitiveDependentCount(r.id),
    related,
    body: body.text,
    bodyTruncated: body.truncated,
  };
}

const generatedAt = new Date().toISOString();

writeFileSync(
  join(APP_LIB, "spec-registry.generated.json"),
  `${JSON.stringify({ generatedAt, total: specs.length, counts, specs, edges }, null, 2)}\n`
);
writeFileSync(
  join(APP_LIB, "spec-details.generated.json"),
  `${JSON.stringify({ generatedAt, details }, null, 2)}\n`
);

console.log(
  `wrote spec-registry.generated.json (${specs.length} specs, ${edges.length} edges) + ` +
    `spec-details.generated.json (${Object.keys(details).length} details)`
);
