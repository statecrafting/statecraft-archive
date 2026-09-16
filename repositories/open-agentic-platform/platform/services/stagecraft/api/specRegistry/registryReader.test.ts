// Spec 163 FR-002 / spec 103 / spec 217: spec-spine registry subprocess wrapper.
//
// The reader is the only path through which statecraft consumes the
// registry. These tests exercise the pure JSON relationship parser, plus
// an integration suite against the OAP repo's own committed
// .derived/spec-registry/by-spec shards via the `spec-spine` CLI (skipped
// when the CLI or the shards are absent, e.g. the ci-statecraft lane).
// Paths resolve relative to this file so the tests do not depend on cwd.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  getSpecDetail,
  getSpecRelationships,
  listSpecs,
  parseRelationshipsJson,
} from "./registryReader";

const __dirname = dirname(fileURLToPath(import.meta.url));
// platform/services/statecraft/api/specRegistry/ -> repo root is 5 levels up.
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..");
const REGISTRY_SHARDS = resolve(REPO_ROOT, ".derived/spec-registry/by-spec");

// Resolve the published spec-spine CLI: explicit env override first, then
// PATH. Tests pass this as `binaryPath` so they do not depend on ambient env.
function resolveSpecSpine(): string | null {
  const fromEnv = process.env.REGISTRY_CONSUMER_BIN;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  try {
    const p = execFileSync("which", ["spec-spine"], { encoding: "utf8" }).trim();
    return p.length > 0 ? p : null;
  } catch {
    return null;
  }
}

const SPEC_SPINE_BIN = resolveSpecSpine();
const haveFixture = existsSync(REGISTRY_SHARDS) && SPEC_SPINE_BIN !== null;

describe("parseRelationshipsJson (pure parser)", () => {
  test("projects outgoing + incoming spec-to-spec edges", () => {
    const json = JSON.stringify({
      id: "163-statecraft-requirements-view",
      dependsOn: [
        "087-unified-workspace-architecture",
        "130-spec-coupling-primary-owner",
      ],
      supersedes: ["050-old-thing"],
      amends: [],
      dependedOnBy: ["200-some-dependent"],
      supersededBy: [],
      amendedBy: ["201-some-amender"],
    });
    const r = parseRelationshipsJson("163-statecraft-requirements-view", json);
    expect(r.id).toBe("163-statecraft-requirements-view");
    expect(r.outgoing).toEqual([
      { kind: "depends_on", otherSpec: "087-unified-workspace-architecture" },
      { kind: "depends_on", otherSpec: "130-spec-coupling-primary-owner" },
      { kind: "supersedes", otherSpec: "050-old-thing" },
    ]);
    expect(r.incoming).toEqual([
      { kind: "depends_on", otherSpec: "200-some-dependent" },
      { kind: "amends", otherSpec: "201-some-amender" },
    ]);
  });

  test("handles missing/empty arrays", () => {
    const r = parseRelationshipsJson("x", JSON.stringify({ id: "x" }));
    expect(r.outgoing).toEqual([]);
    expect(r.incoming).toEqual([]);
  });

  test("filters non-string and empty entries", () => {
    const json = JSON.stringify({ dependsOn: ["001-real", "", null, 42] });
    const r = parseRelationshipsJson("y", json);
    expect(r.outgoing).toEqual([{ kind: "depends_on", otherSpec: "001-real" }]);
  });
});

describe.skipIf(!haveFixture)("registryReader against OAP's own registry", () => {
  const opts = { binaryPath: SPEC_SPINE_BIN! };

  test("listSpecs returns sorted typed rows (FR-001, FR-002)", async () => {
    const specs = await listSpecs(REPO_ROOT, opts);
    expect(specs.length).toBeGreaterThan(150);
    // Sorted by id.
    for (let i = 1; i < specs.length; i++) {
      expect(specs[i - 1].id.localeCompare(specs[i].id)).toBeLessThanOrEqual(0);
    }
    const bootstrap = specs.find((s) => s.id === "000-bootstrap-spec-system");
    expect(bootstrap).toBeDefined();
    expect(bootstrap!.status).toBe("approved");
    expect(bootstrap!.title).toBeTruthy();
  });

  test("getSpecDetail attaches the markdown body (FR-006)", async () => {
    const detail = await getSpecDetail(
      "163-statecraft-requirements-view",
      REPO_ROOT,
      REPO_ROOT,
      opts
    );
    expect(detail.id).toBe("163-statecraft-requirements-view");
    expect(detail.body.length).toBeGreaterThan(0);
    // Frontmatter must be stripped: the body must not start with `---`.
    expect(detail.body.startsWith("---")).toBe(false);
  });

  test("getSpecRelationships parses the typed neighborhood (FR-006)", async () => {
    const r = await getSpecRelationships(
      "217-spec-spine-engine-swap-collapse",
      REPO_ROOT,
      opts
    );
    expect(r.id).toBe("217-spec-spine-engine-swap-collapse");
    expect(Array.isArray(r.outgoing)).toBe(true);
    expect(Array.isArray(r.incoming)).toBe(true);
    // 217 depends on several specs; its neighborhood is non-empty.
    expect(r.outgoing.length + r.incoming.length).toBeGreaterThan(0);
    expect(
      r.outgoing.every(
        (e) => typeof e.kind === "string" && typeof e.otherSpec === "string"
      )
    ).toBe(true);
  });
});
