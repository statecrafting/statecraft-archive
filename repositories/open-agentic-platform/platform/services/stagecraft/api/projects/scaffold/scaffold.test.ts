// Pure-helper tests for the spec 112 Phase 5 scaffold subflow.

import { describe, expect, test } from "vitest";
import { buildL0PipelineStateSeed } from "./seedPipelineState";
import { buildProjectOpenDeepLink } from "./deepLink";
import {
  PROFILES,
  deriveModuleCatalog,
  deriveInstallOrder,
  extrasFor,
  profileModulesFor,
  parseScaffoldProfiles,
  pickProfileFromModules,
  isKnownModule,
  isModuleManifestPath,
  type ProfileDefault,
  type RawModuleManifest,
} from "./moduleCatalog";
import type { ScaffoldAdapterRef } from "./types";

// Spec 227 Stage 1: the catalog derives from the adapter's module manifests.
// This fixture mirrors the five real acme-vue-encore module manifest.json
// shapes (id/description/requires/conflicts/status) so the derivation tests
// exercise the same relationships the substrate would feed at runtime.
const MODULE_MANIFEST_FIXTURE: RawModuleManifest[] = [
  { name: "security-core", description: "sec", requires: [], conflicts: [], status: "stable" },
  { name: "api-gateway", description: "bff", requires: ["security-core"], conflicts: [], status: "stable" },
  { name: "data-postgres", description: "pg", requires: [], conflicts: [], status: "stable" },
  { name: "data-redis", description: "redis", requires: [], conflicts: [], status: "stable" },
  { name: "user-management", description: "users", requires: [], conflicts: [], status: "stable" },
];
const catalog = deriveModuleCatalog(MODULE_MANIFEST_FIXTURE);

// Spec 140 §2.2 — the legacy `templateRemote` / `templateDefaultBranch`
// fields no longer exist on `ScaffoldAdapterRef`; the clone target is
// resolved via `factory_upstreams` at warmup / create time.
const adapter: ScaffoldAdapterRef = {
  id: "00000000-0000-0000-0000-000000000000",
  name: "acme-vue-encore",
  version: "3.0.0",
  sourceSha: "a".repeat(40),
};

describe("buildL0PipelineStateSeed", () => {
  test("produces a schema-1.0.0 seed with pending status and embedded adapter identity", () => {
    const seed = buildL0PipelineStateSeed(adapter);
    expect(seed.schema_version).toBe("1.0.0");
    expect(seed.pipeline.status).toBe("pending");
    expect(seed.pipeline.started_at).toBeNull();
    expect(seed.pipeline.adapter).toEqual({
      name: "acme-vue-encore",
      version: "3.0.0",
      source_sha: "a".repeat(40),
    });
    expect(seed.pipeline.build_spec).toEqual({ path: null, hash: null });
    expect(seed.stages).toEqual({});
    expect(seed.pipeline.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  test("emits a fresh pipeline id per invocation", () => {
    const a = buildL0PipelineStateSeed(adapter);
    const b = buildL0PipelineStateSeed(adapter);
    expect(a.pipeline.id).not.toBe(b.pipeline.id);
  });
});

describe("buildProjectOpenDeepLink", () => {
  test("encodes project_id, clone url, and detection level", () => {
    const link = buildProjectOpenDeepLink({
      projectId: "11111111-2222-3333-4444-555555555555",
      cloneUrl: "https://github.com/acme/example.git",
      detectionLevel: "scaffold_only",
    });
    const url = new URL(link);
    expect(url.protocol).toBe("opc:");
    expect(url.host).toBe("project");
    expect(url.pathname).toBe("/open");
    expect(url.searchParams.get("project_id")).toBe(
      "11111111-2222-3333-4444-555555555555"
    );
    expect(url.searchParams.get("url")).toBe(
      "https://github.com/acme/example.git"
    );
    expect(url.searchParams.get("level")).toBe("scaffold_only");
  });
});

describe("moduleCatalog derivation (spec 227 Stage 1)", () => {
  test("the derived catalog is exactly the adapter's modules/ set", () => {
    expect(catalog.map((m) => m.id).sort()).toEqual([
      "api-gateway",
      "data-postgres",
      "data-redis",
      "security-core",
      "user-management",
    ]);
  });

  test("manifest fields drive the descriptor (requires/description/status)", () => {
    const gw = catalog.find((m) => m.id === "api-gateway");
    expect(gw?.requires).toEqual(["security-core"]);
    expect(gw?.description).toBe("bff");
    expect(gw?.status).toBe("stable");
  });

  test("presentation overlay supplies displayName/category; fallback for unknown ids", () => {
    expect(catalog.find((m) => m.id === "data-redis")?.displayName).toBe("Redis");
    expect(catalog.find((m) => m.id === "data-redis")?.category).toBe("Data");
    const [extra] = deriveModuleCatalog([{ name: "new-thing" }]);
    expect(extra.displayName).toBe("New Thing");
    expect(extra.category).toBe("Other");
  });

  test("cron surfaces as an Application feature that requires data-postgres (spec 227 cron stage)", () => {
    // The OAP consumer of factory-encore spec 009: cron is an Application
    // feature (so it renders in the create form) whose manifest-declared
    // `requires: ["data-postgres"]` drives the picker's transitive closure.
    const [cron] = deriveModuleCatalog([
      {
        name: "cron",
        description:
          "In-app scheduler. Lock: Postgres by default, Redis when REDIS_URL is set.",
        requires: ["data-postgres"],
        conflicts: [],
        status: "stable",
      },
    ]);
    expect(cron.id).toBe("cron");
    expect(cron.displayName).toBe("Cron Scheduler");
    expect(cron.category).toBe("Application");
    expect(cron.requires).toEqual(["data-postgres"]);
  });

  test("a manifest name colliding with a prototype key uses the fallback overlay", () => {
    // Without a prototype-safe lookup, a module named `__proto__`/`constructor`
    // would resolve to a truthy prototype value and leave displayName/category
    // undefined instead of taking the title-cased + "Other" fallback.
    for (const name of ["__proto__", "constructor"]) {
      const [derived] = deriveModuleCatalog([{ name }]);
      expect(derived.id).toBe(name);
      expect(typeof derived.displayName).toBe("string");
      expect(derived.displayName.length).toBeGreaterThan(0);
      expect(derived.category).toBe("Other");
    }
  });

  test("a malformed manifest (requires as a string) yields an empty edge list, not char-spread", () => {
    // JSON.parse + cast can let a malformed `"requires": "security-core"`
    // through; a bare spread would iterate it into single characters. The
    // coercion must produce [] instead of ["s","e","c",...].
    const [derived] = deriveModuleCatalog([
      { name: "bad", requires: "security-core" as unknown as string[] },
    ]);
    expect(derived.requires).toEqual([]);
    expect(derived.conflicts).toEqual([]);
  });

  test("retired express-session-era and auth-module ids are unknown", () => {
    for (const retired of [
      "auth-saml",
      "auth-entra-id",
      "session-store-redis",
      "session-store-postgres",
      "service-auth",
      "api-docs",
    ]) {
      expect(isKnownModule(catalog, retired)).toBe(false);
    }
  });

  test("profileModulesFor projects a profile's built-ins (internal ships user-management)", () => {
    const profiles: ProfileDefault[] = [
      { name: "public", variant: "single-public", modules: [] },
      { name: "internal", variant: "single-internal", modules: ["user-management"] },
      { name: "dual", variant: "dual", modules: [] },
    ];
    expect(profileModulesFor(profiles, "internal")).toEqual(["user-management"]);
    expect(profileModulesFor(profiles, "public")).toEqual([]);
    // A profile absent from the manifest projection resolves to [].
    expect(profileModulesFor(profiles, "minimal")).toEqual([]);
    for (const p of PROFILES) {
      expect(Array.isArray(profileModulesFor(profiles, p))).toBe(true);
    }
  });

  test("deriveInstallOrder covers the catalog and puts security-core before api-gateway", () => {
    const order = deriveInstallOrder(catalog);
    expect([...order].sort()).toEqual(catalog.map((m) => m.id).sort());
    expect(order.indexOf("security-core")).toBeLessThan(
      order.indexOf("api-gateway")
    );
  });
});

describe("isModuleManifestPath (spec 227 Stage 1)", () => {
  test("matches an adapter module manifest.json path", () => {
    expect(
      isModuleManifestPath("adapters/acme-vue-encore/modules/data-redis/manifest.json")
    ).toBe(true);
  });

  test("rejects the top-level adapter manifest and non-manifest module files", () => {
    expect(isModuleManifestPath("adapters/acme-vue-encore/manifest.yaml")).toBe(false);
    expect(
      isModuleManifestPath("adapters/acme-vue-encore/modules/data-redis/web.snippet.ts")
    ).toBe(false);
    expect(isModuleManifestPath("modules/data-redis/manifest.json")).toBe(false);
  });
});

describe("pickProfileFromModules", () => {
  test("variant=dual always picks dual regardless of modules", () => {
    expect(pickProfileFromModules("dual", [])).toBe("dual");
    expect(pickProfileFromModules("dual", ["api-gateway"])).toBe("dual");
  });

  test("variant=single-public → public", () => {
    expect(pickProfileFromModules("single-public", [])).toBe("public");
  });

  test("variant=single-internal → internal", () => {
    expect(pickProfileFromModules("single-internal", [])).toBe("internal");
  });

  test("unknown variant → minimal (auth is the AUTH_DRIVER axis, not a module)", () => {
    expect(pickProfileFromModules("unspecified", ["api-gateway"])).toBe("minimal");
    expect(pickProfileFromModules("unspecified", [])).toBe("minimal");
  });
});

describe("parseScaffoldProfiles (spec 227 Stage 2)", () => {
  test("projects scaffold.profiles (internal ships user-management)", () => {
    const manifest = {
      scaffold: {
        profiles: [
          { name: "public", variant: "single-public", auth_driver: "rauthy-oidc", modules: [] },
          { name: "internal", variant: "single-internal", auth_driver: "rauthy-oidc", modules: ["user-management"] },
          { name: "dual", variant: "dual", auth_driver: "rauthy-oidc", modules: [] },
        ],
      },
    };
    const profiles = parseScaffoldProfiles(manifest);
    expect(profiles.map((p) => p.name)).toEqual(["public", "internal", "dual"]);
    expect(profileModulesFor(profiles, "internal")).toEqual(["user-management"]);
    expect(profiles[0].authDriver).toBe("rauthy-oidc");
  });

  test("a missing or malformed scaffold.profiles yields []", () => {
    expect(parseScaffoldProfiles(null)).toEqual([]);
    expect(parseScaffoldProfiles({})).toEqual([]);
    expect(parseScaffoldProfiles({ scaffold: {} })).toEqual([]);
    expect(parseScaffoldProfiles({ scaffold: { profiles: "nope" } })).toEqual([]);
  });

  test("non-string modules are filtered and entries missing name/variant are skipped", () => {
    const profiles = parseScaffoldProfiles({
      scaffold: {
        profiles: [
          { name: "internal", variant: "single-internal", modules: ["user-management", 5, null] },
          { variant: "single-public" }, // missing name -> skipped
          { name: "no-variant" }, // missing variant -> skipped
          "garbage",
        ],
      },
    });
    expect(profiles).toHaveLength(1);
    expect(profiles[0].modules).toEqual(["user-management"]);
  });
});

describe("extrasFor", () => {
  test("every selected module is an extra (no profile built-ins exist)", () => {
    // extrasFor returns a deterministic install order: deriveInstallOrder sorts
    // ids alphabetically within each dependency level, so with two dependency-free
    // modules the exact order is a contract worth pinning (data-redis < user-management).
    const result = extrasFor(catalog, [], ["data-redis", "user-management"]);
    expect(result).toEqual(["data-redis", "user-management"]);
  });

  test("profile built-ins are filtered out of the extras", () => {
    // internal ships user-management; re-selecting it yields no extra for it.
    expect(
      extrasFor(catalog, ["user-management"], ["user-management", "data-redis"])
    ).toEqual(["data-redis"]);
  });

  test("install order respects dependencies: security-core before api-gateway", () => {
    // The only ordering constraint is deps-before-dependents; api-gateway
    // requires security-core, user-management is independent. Assert the
    // invariant + presence, not an arbitrary exact permutation.
    const result = extrasFor(catalog, [], [
      "user-management",
      "api-gateway",
      "security-core",
    ]);
    expect([...result].sort()).toEqual([
      "api-gateway",
      "security-core",
      "user-management",
    ]);
    expect(result.indexOf("security-core")).toBeLessThan(
      result.indexOf("api-gateway")
    );
  });

  test("returns empty when nothing is selected", () => {
    expect(extrasFor(catalog, [], [])).toEqual([]);
  });

  test("unknown (incl. retired) modules are dropped", () => {
    expect(
      extrasFor(catalog, [], ["bogus-not-real", "session-store-redis"])
    ).toEqual([]);
  });
});

describe("spec 112 §10 runtime gate (shape)", () => {
  // The gate lives in create.ts; this test pins the shape of manifests we
  // expect to pass / fail so a translator change doesn't silently
  // re-introduce non-Node-24 adapters. Spec 140 §2.1 introduced the
  // top-level `scaffold_runtime` key; the gate accepts both the legacy
  // `scaffold.runtime` block and the new top-level field.
  function evaluateRuntimeGate(manifest: Record<string, unknown>): "pass" | "reject" {
    const declared =
      (manifest as { scaffold?: { runtime?: string } }).scaffold?.runtime ??
      (typeof (manifest as { scaffold_runtime?: unknown }).scaffold_runtime ===
      "string"
        ? ((manifest as { scaffold_runtime: string }).scaffold_runtime)
        : undefined);
    if (declared && declared !== "node-24") return "reject";
    return "pass";
  }

  test("synthetic translator manifest carrying scaffold_runtime: node-24 passes", () => {
    expect(
      evaluateRuntimeGate({
        entry: "orchestration/template-orchestrator.md",
        scaffold_source_id: "legacy-template-source",
        scaffold_runtime: "node-24",
      })
    ).toBe("pass");
  });

  test("manifest without any runtime declaration passes (default)", () => {
    expect(
      evaluateRuntimeGate({
        entry: "orchestration/template-orchestrator.md",
      })
    ).toBe("pass");
  });

  test("explicitly declared node-24 (legacy scaffold block) passes", () => {
    expect(evaluateRuntimeGate({ scaffold: { runtime: "node-24" } })).toBe(
      "pass"
    );
  });

  test("non-node-24 top-level scaffold_runtime is rejected", () => {
    expect(evaluateRuntimeGate({ scaffold_runtime: "node-22" })).toBe("reject");
  });

  test("deno-2 / python / anything-else is rejected", () => {
    expect(evaluateRuntimeGate({ scaffold: { runtime: "deno-2" } })).toBe(
      "reject"
    );
    expect(evaluateRuntimeGate({ scaffold: { runtime: "python-3.12" } })).toBe(
      "reject"
    );
  });
});

describe("isKnownModule", () => {
  test("recognises catalogued modules", () => {
    expect(isKnownModule(catalog, "security-core")).toBe(true);
    expect(isKnownModule(catalog, "user-management")).toBe(true);
  });

  test("rejects unknown ids", () => {
    expect(isKnownModule(catalog, "nope")).toBe(false);
    expect(isKnownModule(catalog, "")).toBe(false);
    expect(isKnownModule(catalog, "auth-core")).toBe(false);
  });
});
