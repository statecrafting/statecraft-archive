// Spec 112 §6.3 — unit tests for the pure bundle assembly helpers.
//
// DB and Encore-runtime path covered by integration testing; this file
// pins the shape-mapping invariants so OPC and the web UI can rely on a
// stable contract.

import { describe, expect, test } from "vitest";
import { buildOpcBundle, cloneUrlFor } from "./opcBundleHelpers";

const SYNCED = new Date("2026-04-22T10:00:00.000Z");

const baseProject = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Vendor Portal",
  slug: "fv-portal",
  orgId: "33333333-3333-3333-3333-333333333333",
  factoryAdapterId: "44444444-4444-4444-4444-444444444444",
};

const baseRepo = {
  githubOrg: "Statecraft-ing",
  repoName: "acme-example-portal",
  defaultBranch: "main",
};

const baseAdapter = {
  id: "44444444-4444-4444-4444-444444444444",
  name: "acme-vue-encore",
  version: "3.0.0",
  sourceSha: "abc123",
  syncedAt: SYNCED,
  manifest: { kind: "adapter", capabilities: { dual_stack: true } },
};

describe("buildOpcBundle", () => {
  test("composes a fully-populated bundle for an imported factory project", () => {
    const bundle = buildOpcBundle({
      project: baseProject,
      repo: baseRepo,
      adapter: baseAdapter,
      contracts: [
        {
          name: "build-spec",
          version: "1.0.0",
          sourceSha: "c1",
          syncedAt: SYNCED,
          schema: { $id: "build-spec" },
        },
      ],
      processes: [
        {
          name: "7-stage-build",
          version: "1.0.0",
          sourceSha: "p1",
          syncedAt: SYNCED,
          definition: { stages: 7 },
        },
      ],
      agents: [
        {
          id: "a1",
          name: "explorer",
          version: 2,
          contentHash: "h1",
          frontmatter: { role: "explorer" },
          bodyMarkdown: "# explorer",
        },
      ],
      cloneToken: null,
      admission: null,
    });

    expect(bundle.project).toEqual({
      id: baseProject.id,
      name: baseProject.name,
      slug: baseProject.slug,
      orgId: baseProject.orgId,
    });
    expect(bundle.repo).toEqual({
      cloneUrl:
        "https://github.com/statecrafting/acme-example-portal.git",
      githubOrg: baseRepo.githubOrg,
      repoName: baseRepo.repoName,
      defaultBranch: "main",
    });
    expect(bundle.deepLink).toBe(
      `opc://project/open?project_id=${baseProject.id}&url=${encodeURIComponent(
        bundle.repo!.cloneUrl
      )}`
    );
    expect(bundle.adapter).toMatchObject({
      id: baseAdapter.id,
      name: "acme-vue-encore",
      syncedAt: SYNCED.toISOString(),
    });
    expect(bundle.contracts).toHaveLength(1);
    expect(bundle.contracts[0]).toMatchObject({
      name: "build-spec",
      syncedAt: SYNCED.toISOString(),
    });
    expect(bundle.processes).toHaveLength(1);
    expect(bundle.agents).toHaveLength(1);
    expect(bundle.agents[0].status).toBe("published");
  });

  test("nulls deep link and repo when no primary repo is bound", () => {
    const bundle = buildOpcBundle({
      project: baseProject,
      repo: null,
      adapter: baseAdapter,
      contracts: [],
      processes: [],
      agents: [],
      cloneToken: null,
      admission: null,
    });

    expect(bundle.repo).toBeNull();
    expect(bundle.deepLink).toBeNull();
    expect(bundle.adapter).not.toBeNull();
    expect(bundle.cloneToken).toBeNull();
  });

  test("nulls adapter for non-factory projects, still returns catalog rows", () => {
    const bundle = buildOpcBundle({
      project: { ...baseProject, factoryAdapterId: null },
      repo: baseRepo,
      adapter: null,
      contracts: [
        {
          name: "build-spec",
          version: "1.0.0",
          sourceSha: "c1",
          syncedAt: SYNCED,
          schema: {},
        },
      ],
      processes: [],
      agents: [],
      cloneToken: null,
      admission: null,
    });

    expect(bundle.adapter).toBeNull();
    expect(bundle.deepLink).not.toBeNull();
    expect(bundle.contracts).toHaveLength(1);
  });

  test("ISO-8601 stringification is consistent across resource families", () => {
    const bundle = buildOpcBundle({
      project: baseProject,
      repo: baseRepo,
      adapter: baseAdapter,
      contracts: [
        {
          name: "build-spec",
          version: "1.0.0",
          sourceSha: "c1",
          syncedAt: SYNCED,
          schema: {},
        },
      ],
      processes: [
        {
          name: "7-stage-build",
          version: "1.0.0",
          sourceSha: "p1",
          syncedAt: SYNCED,
          definition: {},
        },
      ],
      agents: [],
      cloneToken: null,
      admission: null,
    });

    expect(bundle.adapter!.syncedAt).toBe(SYNCED.toISOString());
    expect(bundle.contracts[0].syncedAt).toBe(SYNCED.toISOString());
    expect(bundle.processes[0].syncedAt).toBe(SYNCED.toISOString());
  });

  test("propagates a github_installation clone token through the bundle", () => {
    const bundle = buildOpcBundle({
      project: baseProject,
      repo: baseRepo,
      adapter: baseAdapter,
      contracts: [],
      processes: [],
      agents: [],
      cloneToken: {
        value: "ghs_FAKE_INSTALL_TOKEN",
        source: "github_installation",
        expiresAt: "2026-04-22T11:00:00.000Z",
      },
      admission: null,
    });

    expect(bundle.cloneToken).toEqual({
      value: "ghs_FAKE_INSTALL_TOKEN",
      source: "github_installation",
      expiresAt: "2026-04-22T11:00:00.000Z",
    });
  });

  test("propagates a project_github_pat clone token with null expiry", () => {
    const bundle = buildOpcBundle({
      project: baseProject,
      repo: baseRepo,
      adapter: baseAdapter,
      contracts: [],
      processes: [],
      agents: [],
      cloneToken: {
        value: "ghp_FAKE_PAT",
        source: "project_github_pat",
        expiresAt: null,
      },
      admission: null,
    });

    expect(bundle.cloneToken?.source).toBe("project_github_pat");
    expect(bundle.cloneToken?.expiresAt).toBeNull();
  });

  test("propagates the admission seal block verbatim (spec 198 FR-014)", () => {
    // Spec 198 FR-013(c) — the consumed-overrides leg rides the block
    // verbatim too; the predicate check happened before assembly.
    const consumedOverrides = [
      {
        artifactId: "11111111-2222-3333-4444-555555555555",
        path: "adapters/acme-vue-encore/agents/scaffolder.md",
        contentHash: "ab".repeat(32),
        author: "66666666-0000-0000-0000-000000000003",
        modifiedAt: "2026-06-10T00:00:00.000Z",
        verified: true,
        verifiedBy: "66666666-0000-0000-0000-000000000004",
      },
    ];
    const bundle = buildOpcBundle({
      project: baseProject,
      repo: baseRepo,
      adapter: baseAdapter,
      contracts: [],
      processes: [],
      agents: [],
      cloneToken: null,
      admission: {
        origin: "factory",
        envelopeHash: "e3b0c44298fc1c149afbf4c8996fb924",
        sealJws: "eyJhbGciOiJFZERTQSJ9.eyJvcmlnaW4iOiJmIn0.c2ln",
        consumedOverrides,
      },
    });

    expect(bundle.admission).toEqual({
      origin: "factory",
      envelopeHash: "e3b0c44298fc1c149afbf4c8996fb924",
      sealJws: "eyJhbGciOiJFZERTQSJ9.eyJvcmlnaW4iOiJmIn0.c2ln",
      consumedOverrides,
    });
  });
});

describe("opc deep-link projection (spec 112 §6.3)", () => {
  // The lightweight `/opc-deep-link` endpoint (getProjectOpcDeepLink) reuses
  // buildOpcBundle with empty collections + a null cloneToken, then projects
  // only { deepLink, adapterName } for the project-layout header. These tests
  // pin the invariant B depends on: switching the header off the full bundle
  // must not change the deep link or the adapter name, and the lightweight
  // path must never carry a clone token (no GitHub installation token minted
  // on a per-navigation loader).
  test("deepLink + adapter name match the full bundle for identical inputs", () => {
    const full = buildOpcBundle({
      project: baseProject,
      repo: baseRepo,
      adapter: baseAdapter,
      contracts: [
        {
          name: "build-spec",
          version: "1.0.0",
          sourceSha: "c1",
          syncedAt: SYNCED,
          schema: {},
        },
      ],
      processes: [
        {
          name: "7-stage-build",
          version: "1.0.0",
          sourceSha: "p1",
          syncedAt: SYNCED,
          definition: {},
        },
      ],
      agents: [
        {
          id: "a1",
          name: "explorer",
          version: 2,
          contentHash: "h1",
          frontmatter: {},
          bodyMarkdown: "",
        },
      ],
      cloneToken: {
        value: "ghs_FAKE_INSTALL_TOKEN",
        source: "github_installation",
        expiresAt: "2026-04-22T11:00:00.000Z",
      },
      admission: null,
    });

    const lightweight = buildOpcBundle({
      project: baseProject,
      repo: baseRepo,
      adapter: baseAdapter,
      contracts: [],
      processes: [],
      agents: [],
      cloneToken: null,
      admission: null,
    });

    expect(lightweight.deepLink).toBe(full.deepLink);
    expect(lightweight.adapter?.name ?? null).toBe(full.adapter?.name ?? null);
    expect(lightweight.cloneToken).toBeNull();
  });

  test("nulls the deep link when no primary repo, adapter name still resolves", () => {
    const lightweight = buildOpcBundle({
      project: baseProject,
      repo: null,
      adapter: baseAdapter,
      contracts: [],
      processes: [],
      agents: [],
      cloneToken: null,
      admission: null,
    });

    expect(lightweight.deepLink).toBeNull();
    expect(lightweight.adapter?.name ?? null).toBe("acme-vue-encore");
  });
});

describe("cloneUrlFor", () => {
  test("returns canonical https github clone URL with .git suffix", () => {
    expect(cloneUrlFor("acme", "foo")).toBe("https://github.com/acme/foo.git");
  });
});
