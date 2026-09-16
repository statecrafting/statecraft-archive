/**
 * The observed-usage side of the verify step (spec 021 §3.2): a transitive
 * import walk from each non-library service directory over backend/,
 * mapping named imports of the governed facades to capability kinds, plus
 * the static ban-list of fork 3's honesty clause.
 *
 * Granularity is deliberately v0.1: exact kinds where the facade names
 * them (hiq facade functions, secret accessors), family level for
 * CoreLedger and egress. Per-verb and per-table static attribution is the
 * named v0.2 extension (spec 020 §3.4).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

/** Named-import maps for the governed facades, keyed by repo-relative target. */
const HIQ_FACADE = "backend/kernel/hiq.ts";
const SECRETS_MODULE = "backend/lib/secrets.ts";
const EGRESS_MODULE = "backend/kernel/egress.ts";

/**
 * The state layer facade (enrahitu spec 032). A DIRECTORY rather than a single
 * file, unlike the others, because its surface splits by concern (sql, watch,
 * lease, backup, migrate) and a consumer may import from `backend/state` or
 * from one submodule. Terminating on the prefix means both routes are observed
 * and neither is a hole.
 *
 * It is a second governed facade over the same addon, not a replacement for
 * `backend/kernel/hiq.ts`: that one governs the CACHE raft group (KV, counters,
 * not durable), this one the SQLITE group (durable state). The split follows the
 * raft groups, which have genuinely different guarantees.
 */
const STATE_FACADE_DIR = "backend/state/";

/**
 * The OTel wiring anchor (enrahitu spec 022): the file that constructs the
 * app's tracer provider. A service that transitively imports it is
 * instrumented; the model's observability.otel derives from that reach.
 */
const OBS_TRACER = "backend/obs/tracer.ts";

const HIQ_KINDS = {
  kvGet: { kind: "kv.get", resource: "cache" },
  kvPut: { kind: "kv.put", resource: "cache" },
  kvDel: { kind: "kv.delete", resource: "cache" },
  counterAdd: { kind: "counter.add", resource: "counters" },
  counterGet: { kind: "counter.get", resource: "counters" },
  counterSet: { kind: "counter.set", resource: "counters" },
  counterDel: { kind: "counter.delete", resource: "counters" },
};

/**
 * The state facade's named exports, mapped to the kinds they exercise.
 *
 * `backup` adjudicates as a bucket write rather than a backup kind because the
 * kernel's vocabulary is a fixed 28 kinds (enrahitu spec 020 §3.3) and boot
 * refuses a model declaring one it does not know. That is not a fudge: a backup
 * genuinely is an object-store write of the database, and `bucket.write` is
 * classified non-read, so it fails closed at `read-only` trust.
 */
const STATE_KINDS = {
  query: { kind: "db.read", resource: "state" },
  queryConsistent: { kind: "db.read", resource: "state" },
  schemaVersion: { kind: "db.read", resource: "state" },
  execute: { kind: "db.write", resource: "state" },
  executeReturning: { kind: "db.write", resource: "state" },
  txn: { kind: "db.txn", resource: "state" },
  migrate: { kind: "db.migrate", resource: "state" },
  lock: { kind: "lock.acquire", resource: "state" },
  withLease: { kind: "lock.acquire", resource: "state" },
  notify: { kind: "notify.publish", resource: "state" },
  listen: { kind: "notify.listen", resource: "state" },
  backup: { kind: "bucket.write", resource: "state-backups" },
  backupListLocal: { kind: "bucket.list", resource: "state-backups" },
  backupListS3: { kind: "bucket.list", resource: "state-backups" },
};

// Model resource names are the lowercase form of the encore secret binding
// (the contract's slug pattern forbids uppercase; spec 021 §3.1).
const SECRET_ACCESSORS = {
  accessPrivateKey: "jwt_private_key",
  accessPublicKey: "jwt_public_key",
  refreshPrivateKey: "jwt_refresh_private_key",
  refreshPublicKey: "jwt_refresh_public_key",
  rauthyClientSecretValue: "rauthy_client_secret",
};

function listTsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** Parse one file's import/export-from edges: [{specifier, named: string[]}]. */
function importEdges(file) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    false,
  );
  const edges = [];
  for (const stmt of source.statements) {
    let specifier;
    const named = [];
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      // Type-only imports are erased at runtime: not a faculty touch and
      // not a wiring edge.
      if (stmt.importClause?.isTypeOnly) continue;
      specifier = stmt.moduleSpecifier.text;
      const bindings = stmt.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          if (el.isTypeOnly) continue;
          named.push((el.propertyName ?? el.name).text);
        }
      } else if (bindings && ts.isNamespaceImport(bindings)) {
        // A namespace import is opaque to per-name attribution: observe it
        // conservatively as touching everything the target module maps.
        named.push("*");
      }
      if (stmt.importClause?.name) named.push("default");
    } else if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
      if (stmt.isTypeOnly) continue;
      specifier = stmt.moduleSpecifier.text;
      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          if (el.isTypeOnly) continue;
          named.push((el.propertyName ?? el.name).text);
        }
      }
    }
    if (specifier) edges.push({ specifier, named });
  }
  return edges;
}

function resolveRelative(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.ts`, join(base, "index.ts")]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* keep looking */
    }
  }
  return undefined;
}

function rel(repoRoot, file) {
  return relative(repoRoot, file).split(sep).join("/");
}

/**
 * Walk one service's reachable modules and collect faculty touches.
 * Traversal stops at faculty targets (the enforcement plane is not
 * app code) and never enters backend/kernel/ or backend/core/ledger/.
 */
export function observeService(repoRoot, serviceDir) {
  const touches = [];
  const seen = new Set();
  const queue = listTsFiles(join(repoRoot, serviceDir));
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const edge of importEdges(file)) {
      if (!edge.specifier.startsWith(".")) continue;
      const target = resolveRelative(file, edge.specifier);
      if (!target) continue;
      const targetRel = rel(repoRoot, target);
      if (!targetRel.startsWith("backend/")) continue;
      if (targetRel === HIQ_FACADE) {
        const names = edge.named.includes("*") ? Object.keys(HIQ_KINDS) : edge.named;
        for (const name of names) {
          if (HIQ_KINDS[name]) touches.push({ ...HIQ_KINDS[name], via: rel(repoRoot, file) });
        }
      } else if (targetRel.startsWith(STATE_FACADE_DIR)) {
        const names = edge.named.includes("*") ? Object.keys(STATE_KINDS) : edge.named;
        for (const name of names) {
          if (STATE_KINDS[name]) touches.push({ ...STATE_KINDS[name], via: rel(repoRoot, file) });
        }
      } else if (targetRel === SECRETS_MODULE) {
        const names = edge.named.includes("*") ? Object.keys(SECRET_ACCESSORS) : edge.named;
        for (const name of names) {
          if (SECRET_ACCESSORS[name]) {
            touches.push({
              kind: "secret.read",
              resource: SECRET_ACCESSORS[name],
              via: rel(repoRoot, file),
            });
          }
        }
      } else if (targetRel === EGRESS_MODULE) {
        touches.push({ family: "http.egress", via: rel(repoRoot, file) });
      } else if (targetRel.startsWith("backend/core/ledger/")) {
        touches.push({ family: "db", via: rel(repoRoot, file) });
      } else if (targetRel.startsWith("backend/kernel/")) {
        // Other kernel modules (boot, adjudicate, decisions) are the
        // enforcement plane itself: not an app-tier faculty touch.
        continue;
      } else {
        queue.push(target);
      }
    }
  }
  return touches;
}

/**
 * Does any service outside backend/obs/ transitively import the OTel
 * tracer anchor (enrahitu spec 022)? The walk mirrors observeService's
 * traversal rules: relative imports only, terminal at the governed
 * facades, never entering backend/kernel/ or backend/core/ledger/. The
 * obs service itself referencing its own tracer proves nothing; reach
 * from an instrumented sibling service is the wiring being observed.
 */
export function otelObserved(repoRoot, serviceRelPaths) {
  for (const serviceDir of serviceRelPaths) {
    const dirRel = serviceDir.replace(/\/+$/, "");
    if (dirRel === "backend/obs" || dirRel.startsWith("backend/obs/")) continue;
    const seen = new Set();
    const queue = listTsFiles(join(repoRoot, serviceDir));
    while (queue.length > 0) {
      const file = queue.pop();
      if (seen.has(file)) continue;
      seen.add(file);
      for (const edge of importEdges(file)) {
        if (!edge.specifier.startsWith(".")) continue;
        const target = resolveRelative(file, edge.specifier);
        if (!target) continue;
        const targetRel = rel(repoRoot, target);
        if (targetRel === OBS_TRACER) return true;
        if (!targetRel.startsWith("backend/")) continue;
        if (targetRel === HIQ_FACADE || targetRel === SECRETS_MODULE || targetRel === EGRESS_MODULE) continue;
        if (targetRel.startsWith(STATE_FACADE_DIR)) continue;
        if (targetRel.startsWith("backend/kernel/")) continue;
        if (targetRel.startsWith("backend/core/ledger/")) continue;
        queue.push(target);
      }
    }
  }
  return false;
}

/** Is `touch` covered by one of `grants` (the service's declared ceiling)? */
export function covered(touch, grants) {
  if (touch.family === "db") return grants.some((g) => g.kind.startsWith("db."));
  if (touch.family === "http.egress") return grants.some((g) => g.kind === "http.egress");
  return grants.some(
    (g) => g.kind === touch.kind && (g.resource === "*" || g.resource === touch.resource),
  );
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const BANS = [
  {
    id: "raw-addon-import",
    allowed: new Set(["backend/hiq/init.ts"]),
    hit: (edges) => edges.some((e) => e.specifier === "@statecrafting/hiqlite-native"),
    message: "raw @statecrafting/hiqlite-native import outside backend/hiq/init.ts",
  },
  {
    id: "raw-hiq-init-import",
    allowed: undefined, // path-prefix rule: two governed facades, see below
    hit: (edges, file, repoRoot) =>
      edges.some((e) => {
        if (!e.specifier.startsWith(".")) return false;
        const target = resolveRelative(file, e.specifier);
        return target !== undefined && rel(repoRoot, target) === "backend/hiq/init.ts";
      }),
    // Two facades reach the addon handle, one per raft group: kernel/hiq.ts for
    // the cache group (KV, counters) and state/ for the SQLITE group (enrahitu
    // spec 032). Everything else goes through one of them.
    allowedPath: (relPath) =>
      relPath === HIQ_FACADE || relPath.startsWith(STATE_FACADE_DIR),
    message:
      "hiq/init import outside the governed facades backend/kernel/hiq.ts and backend/state/",
  },
  {
    id: "bare-fetch",
    allowed: new Set(["backend/kernel/egress.ts"]),
    hit: (_edges, file) => /(?<![.\w])fetch\s*\(/.test(stripComments(readFileSync(file, "utf8"))),
    message: "bare fetch() outside the governed egress facade backend/kernel/egress.ts",
  },
  {
    id: "raw-driver",
    allowed: undefined, // path-prefix rule, see below
    hit: (_edges, file) =>
      /\b(new\s+(LibsqlDriver|PostgresDriver)\s*\(|rawDriverFromEnv\s*\()/.test(
        stripComments(readFileSync(file, "utf8")),
      ),
    allowedPath: (relPath) =>
      relPath.startsWith("backend/core/ledger/") || relPath === "backend/kernel/decisions.ts",
    message:
      "raw driver construction outside backend/core/ledger/ and the Decision store",
  },
  {
    id: "raw-secret-binding",
    allowed: new Set(["backend/lib/secrets.ts"]),
    hit: (edges) => edges.some((e) => e.specifier === "encore.dev/config"),
    message: "encore.dev/config secret binding outside backend/lib/secrets.ts",
  },
];

/** Scan all backend runtime modules against the ban-list. */
export function banViolations(repoRoot) {
  const violations = [];
  for (const file of listTsFiles(join(repoRoot, "backend"))) {
    const relPath = rel(repoRoot, file);
    const edges = importEdges(file);
    for (const ban of BANS) {
      if (!ban.hit(edges, file, repoRoot)) continue;
      const ok = ban.allowedPath ? ban.allowedPath(relPath) : ban.allowed.has(relPath);
      if (!ok) violations.push(`${relPath}: ${ban.message}`);
    }
  }
  return violations;
}
