// Spec 163 §7 / FR-007 — resolver behaviour. The resolver MUST return
// null when no registry is materialised so the Requirements view
// renders the empty-state CTA instead of erroring.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { resolveProjectRegistry } from "./resolver";

describe("resolveProjectRegistry", () => {
  let base: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "statecraft-spec-registry-"));
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  test("returns null when STATECRAFT_PROJECT_REGISTRY_BASE is unset (FR-007)", async () => {
    const res = await resolveProjectRegistry("any-project", { base: null });
    expect(res).toBeNull();
  });

  test("returns null when the per-project registry file is absent (FR-007)", async () => {
    // Base exists but no project subdirectory.
    const res = await resolveProjectRegistry("missing-project", { base });
    expect(res).toBeNull();
  });

  test("returns paths when the sharded registry is materialised", async () => {
    const projectId = "11111111-2222-3333-4444-555555555555";
    const projectRoot = join(base, projectId);
    // Spec 217: the resolver probes for the committed shard directory
    // (.derived/spec-registry/by-spec), not a monolithic registry.json.
    const bySpecDir = join(projectRoot, ".derived", "spec-registry", "by-spec");
    await mkdir(bySpecDir, { recursive: true });
    await writeFile(
      join(bySpecDir, "000-bootstrap-spec-system.json"),
      JSON.stringify({ specVersion: "1.0.0", shardHash: "0", record: { id: "000-bootstrap-spec-system" } })
    );

    const res = await resolveProjectRegistry(projectId, { base });
    expect(res).not.toBeNull();
    expect(res!.projectRoot).toBe(projectRoot);
    expect(res!.registryPath).toBe(bySpecDir);
  });
});
