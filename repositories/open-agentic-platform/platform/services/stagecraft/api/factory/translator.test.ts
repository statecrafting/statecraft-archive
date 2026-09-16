import { describe, expect, test, beforeAll, afterAll } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyArtifactKind,
  translateLegacyManifest,
  translateUpstreamsToSubstrate,
  type GoaSoftwareFactoryManifest,
  type GoaWorkingState,
  type FactoryAdapterRow,
} from "./translator";

async function writeTree(
  root: string,
  files: Record<string, string>
): Promise<void> {
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    const parent = abs.substring(0, abs.lastIndexOf("/"));
    await mkdir(parent, { recursive: true });
    await writeFile(abs, body, "utf8");
  }
}

// Spec 199 FR-008 — the classifier handles the owned 3-layer layout with no
// `Factory Agent/` or frontmatter-`type:` dependence.
describe("classifyArtifactKind (owned layout)", () => {
  test("governance envelope, orchestrator, agents, stages, skills", () => {
    expect(classifyArtifactKind("process/governance-envelope.yaml", null)).toBe(
      "governance-envelope",
    );
    expect(
      classifyArtifactKind("process/agents/pipeline-orchestrator.md", null),
    ).toBe("pipeline-orchestrator");
    expect(
      classifyArtifactKind("process/agents/api-architect.md", null),
    ).toBe("agent");
    expect(
      classifyArtifactKind(
        "adapters/acme-vue-encore/agents/api-scaffolder.md",
        null,
      ),
    ).toBe("agent");
    expect(
      classifyArtifactKind("process/stages/00-pre-flight.md", null),
    ).toBe("process-stage");
    expect(
      classifyArtifactKind("process/stages/cd-client-documentation.md", null),
    ).toBe("process-stage");
    expect(classifyArtifactKind("process/skills/validate.md", null)).toBe(
      "skill",
    );
  });

  test("adapter manifest, patterns, invariants, contracts", () => {
    expect(
      classifyArtifactKind("adapters/acme-vue-encore/manifest.yaml", null),
    ).toBe("adapter-manifest");
    expect(
      classifyArtifactKind(
        "adapters/acme-vue-encore/patterns/api/endpoint.md",
        null,
      ),
    ).toBe("pattern");
    expect(
      classifyArtifactKind(
        "adapters/acme-vue-encore/validation/invariants.yaml",
        null,
      ),
    ).toBe("invariant");
    expect(
      classifyArtifactKind("contract/schemas/build-spec.schema.yaml", null),
    ).toBe("contract-schema");
    expect(
      classifyArtifactKind(
        "contract/examples/stage-outputs/audiences.json",
        null,
      ),
    ).toBe("reference-data");
  });
});

describe("translateUpstreamsToSubstrate (origin-from-source)", () => {
  let factoryRepo: string;
  let templateRepo: string;

  beforeAll(async () => {
    factoryRepo = await mkdtemp(join(tmpdir(), "factory-src-"));
    templateRepo = await mkdtemp(join(tmpdir(), "template-src-"));
    await writeTree(factoryRepo, {
      "process/governance-envelope.yaml": 'schema_version: "1.0.0"\n',
      "process/agents/pipeline-orchestrator.md":
        "---\nid: pipeline-orchestrator\nsafety_tier: tier1\nmutation: read-only\n---\nbody\n",
      "adapters/acme-vue-encore/manifest.yaml":
        'schema_version: "1.1.0"\nadapter:\n  name: acme-vue-encore\n  version: "1.0.0"\n',
      "docs/architecture.md": "excluded prose\n",
      "README.md": "excluded\n",
    });
    await writeTree(templateRepo, {
      "orchestration/template-orchestrator.md": "---\ntitle: t\n---\nbody\n",
    });
  });

  afterAll(async () => {
    await rm(factoryRepo, { recursive: true, force: true });
    await rm(templateRepo, { recursive: true, force: true });
  });

  test("rows carry the configured source ids as origins; excludes hold", async () => {
    const result = await translateUpstreamsToSubstrate({
      factorySourcePath: factoryRepo,
      factorySourceSha: "f".repeat(40),
      templatePath: templateRepo,
      templateSha: "t".repeat(40),
      factoryOriginId: "my-factory-source",
      templateOriginId: "my-template-source",
    });
    expect(result.factoryOriginId).toBe("my-factory-source");
    expect(result.templateOriginId).toBe("my-template-source");
    const factoryPaths = result.rows
      .filter((r) => r.origin === "my-factory-source")
      .map((r) => r.path);
    expect(factoryPaths).toContain("process/governance-envelope.yaml");
    expect(factoryPaths).toContain("adapters/acme-vue-encore/manifest.yaml");
    expect(factoryPaths).not.toContain("docs/architecture.md");
    expect(factoryPaths).not.toContain("README.md");
    const envelope = result.rows.find(
      (r) => r.path === "process/governance-envelope.yaml",
    );
    expect(envelope?.kind).toBe("governance-envelope");
  });
});

// Spec 199 FR-008: the owned repos ship a Docusaurus `website/` docs tree of
// binary assets that must never reach the UTF-8 TEXT substrate, and any other
// stray binary file must be skipped rather than wedge the whole sync.
describe("translateUpstreamsToSubstrate (website exclude + binary skip)", () => {
  let factoryRepo: string;
  let templateRepo: string;
  const NUL = String.fromCharCode(0);

  beforeAll(async () => {
    factoryRepo = await mkdtemp(join(tmpdir(), "factory-bin-"));
    templateRepo = await mkdtemp(join(tmpdir(), "template-bin-"));
    await writeTree(factoryRepo, {
      "adapters/acme-vue-encore/manifest.yaml":
        'schema_version: "1.1.0"\nadapter:\n  name: acme-vue-encore\n',
      // Docusaurus binary asset under website/: excluded by path before read.
      "website/static/img/favicon.ico": `ICO${NUL}${NUL}binary`,
      "website/docusaurus.config.ts": "export default {};\n",
      // A stray binary OUTSIDE website/, at an otherwise-included path:
      // caught by the NUL-byte guard and reported as skipped.
      "contract/examples/payload.bin": `PNG${NUL}rawbytes`,
      "contract/examples/ok.json": '{"ok":true}\n',
    });
    await writeTree(templateRepo, {
      "orchestration/template-orchestrator.md": "---\ntitle: t\n---\nbody\n",
      "website/static/img/favicon.ico": `ICO${NUL}binary`,
    });
  });

  afterAll(async () => {
    await rm(factoryRepo, { recursive: true, force: true });
    await rm(templateRepo, { recursive: true, force: true });
  });

  test("excludes website/ and skips NUL-byte binaries, mirrors the rest", async () => {
    const result = await translateUpstreamsToSubstrate({
      factorySourcePath: factoryRepo,
      factorySourceSha: "f".repeat(40),
      templatePath: templateRepo,
      templateSha: "t".repeat(40),
      factoryOriginId: "acme-factory",
      templateOriginId: "acme-template",
    });
    const paths = result.rows.map((r) => r.path);

    // website/ is excluded by path in BOTH repos (never even read).
    expect(paths).not.toContain("website/static/img/favicon.ico");
    expect(paths).not.toContain("website/docusaurus.config.ts");
    // website/ files are excluded by path, so they are NOT reported as binary.
    expect(result.skippedBinaryPaths).not.toContain(
      "website/static/img/favicon.ico",
    );

    // The stray binary at an included path is skipped via the NUL guard.
    expect(paths).not.toContain("contract/examples/payload.bin");
    expect(result.skippedBinaryPaths).toContain("contract/examples/payload.bin");

    // Genuine text content still mirrors.
    expect(paths).toContain("adapters/acme-vue-encore/manifest.yaml");
    expect(paths).toContain("contract/examples/ok.json");

    // No mirrored row carries a NUL byte (would break the TEXT insert).
    for (const row of result.rows) {
      expect(row.upstreamBody.includes(NUL)).toBe(false);
    }
  });
});

describe("translateLegacyManifest", () => {
  const aimAdapter: FactoryAdapterRow = {
    name: "acme-vue-encore",
    version: "3.0.0",
    sourceSha: "a".repeat(40),
  };

  function fullyExecutedManifest(): GoaSoftwareFactoryManifest {
    return {
      pipelineStatus: "COMPLETE",
      completedAt: "2026-04-22T00:00:00Z",
      factoryInputs: {
        clientTechStack: "Vue 3 + GoA Design System",
        templateVariant: "dual",
      },
      stages: {
        stage1_businessRequirements: {
          status: "PASSED",
          startedAt: "2026-04-21T13:16:00Z",
          completedAt: "2026-04-21T13:32:00Z",
          artifacts: [
            "requirements/business_requirements_document.md",
            "requirements/data_io_schema.json",
          ],
        },
        stage2_serviceRequirements: {
          status: "PASSED",
          startedAt: "2026-04-21T13:35:00Z",
          completedAt: "2026-04-21T14:15:00Z",
        },
        stage3_databaseDesign: {
          status: "PASSED",
          startedAt: "2026-04-21T14:48:00Z",
          completedAt: "2026-04-21T15:05:00Z",
        },
        stage4_apiControllers: {
          status: "PASSED",
          startedAt: "2026-04-21T15:30:00Z",
          completedAt: "2026-04-22T00:00:00Z",
        },
        stage5_clientInterface: {
          status: "PASSED",
          startedAt: "2026-04-21T18:00:00Z",
          completedAt: "2026-04-21T22:15:00Z",
        },
      },
    };
  }

  const workingState: GoaWorkingState = {
    schemaVersion: "1.2",
    completedAt: "2026-04-21T22:15:00Z",
    templateVariant: "dual",
  };

  test("fully-complete manifest produces 7-stage completed pipeline-state", () => {
    const out = translateLegacyManifest(fullyExecutedManifest(), workingState, [aimAdapter]);
    expect(out.schema_version).toBe("1.0.0");
    expect(out.pipeline.status).toBe("completed");
    expect(out.pipeline.adapter.name).toBe("acme-vue-encore");
    expect(out.pipeline.adapter.version).toBe("3.0.0");
    // Seven stages: pre-flight + 5 mapped + adapter-handoff.
    expect(Object.keys(out.stages).sort()).toEqual(
      [
        "adapter-handoff",
        "api-specification",
        "business-requirements",
        "data-model",
        "pre-flight",
        "service-requirements",
        "ui-specification",
      ]
    );
    for (const [, entry] of Object.entries(out.stages)) {
      // adapter-handoff is pending without fileOwnership; every other stage
      // must be completed when the legacy run was fully executed.
      if (entry === out.stages["adapter-handoff"]) {
        expect(entry.status).toBe("pending");
      } else {
        expect(entry.status).toBe("completed");
      }
    }
  });

  test("preserves stage completion timestamps and artefact references", () => {
    const out = translateLegacyManifest(fullyExecutedManifest(), workingState, [aimAdapter]);
    const br = out.stages["business-requirements"];
    expect(br.started_at).toBe("2026-04-21T13:16:00Z");
    expect(br.completed_at).toBe("2026-04-21T13:32:00Z");
    expect(br.artifacts).toEqual([
      {
        path: "requirements/business_requirements_document.md",
        type: "document",
        hash: "",
      },
      {
        path: "requirements/data_io_schema.json",
        type: "data",
        hash: "",
      },
    ]);
  });

  test("partial legacy manifest produces paused pipeline with per-stage status", () => {
    const manifest = fullyExecutedManifest();
    manifest.pipelineStatus = "IN_PROGRESS";
    manifest.stages!.stage3_databaseDesign.status = "IN_PROGRESS";
    delete manifest.stages!.stage3_databaseDesign.completedAt;
    delete manifest.stages!.stage4_apiControllers;
    delete manifest.stages!.stage5_clientInterface;

    const out = translateLegacyManifest(manifest, workingState, [aimAdapter]);
    expect(out.pipeline.status).toBe("paused");
    expect(out.stages["business-requirements"].status).toBe("completed");
    expect(out.stages["service-requirements"].status).toBe("completed");
    expect(out.stages["data-model"].status).toBe("in_progress");
    expect(out.stages["api-specification"].status).toBe("pending");
    expect(out.stages["ui-specification"].status).toBe("pending");
  });

  test("synthesises adapter-handoff as completed when fileOwnership is present", () => {
    const manifest = fullyExecutedManifest();
    manifest.fileOwnership = {
      "apps/public/src/views/Home.vue": "factory",
    };
    const out = translateLegacyManifest(manifest, workingState, [aimAdapter]);
    expect(out.stages["adapter-handoff"].status).toBe("completed");
  });

  test("falls back to first adapter when no Vue hint matches", () => {
    const manifest = fullyExecutedManifest();
    manifest.factoryInputs = { clientTechStack: "React" };
    const other: FactoryAdapterRow = { name: "rust-axum", version: "0.1.0" };
    const out = translateLegacyManifest(manifest, workingState, [other, aimAdapter]);
    expect(out.pipeline.adapter.name).toBe("rust-axum");
  });

  test("throws when orgAdapters is empty — no synthetic fallback (spec 199 FR-002)", () => {
    expect(() =>
      translateLegacyManifest(fullyExecutedManifest(), workingState, [])
    ).toThrow(/requires at least one org adapter/);
  });

  test("emits a unique pipeline.id per invocation", () => {
    const a = translateLegacyManifest(fullyExecutedManifest(), workingState, [aimAdapter]);
    const b = translateLegacyManifest(fullyExecutedManifest(), workingState, [aimAdapter]);
    expect(a.pipeline.id).not.toBe(b.pipeline.id);
    expect(a.pipeline.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  test("defers build-spec unification — emits placeholder path+hash", () => {
    const out = translateLegacyManifest(fullyExecutedManifest(), workingState, [aimAdapter]);
    expect(out.pipeline.build_spec).toEqual({ path: "requirements/", hash: "" });
  });
});
