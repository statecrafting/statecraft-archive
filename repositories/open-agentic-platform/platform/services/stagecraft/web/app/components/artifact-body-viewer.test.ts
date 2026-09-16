import { describe, expect, test } from "vitest";
import {
  detectArtifactBodyKind,
  getArtifactDisplayBody,
  getArtifactMetadata,
  isSourceTabAvailable,
  unescapeBundleBody,
  unwrapArtifactEnvelope,
  walkBundleEntries,
  type FactoryArtifact,
} from "./artifact-body-viewer";

describe("detectArtifactBodyKind", () => {
  test("detects markdown by .md path", () => {
    expect(detectArtifactBodyKind({ path: "agents/orchestrator.md" })).toBe(
      "markdown"
    );
  });

  test("detects yaml by .schema.yaml path", () => {
    expect(
      detectArtifactBodyKind({ path: "Factory Agent/contracts/adapter-manifest.schema.yaml" })
    ).toBe("yaml");
  });

  test("detects yaml by plain .yml path", () => {
    expect(detectArtifactBodyKind({ path: "config.yml" })).toBe("yaml");
  });

  test("detects json by .json path", () => {
    expect(detectArtifactBodyKind({ path: "build-spec.json" })).toBe("json");
  });

  test("detects json by body starting with {", () => {
    expect(detectArtifactBodyKind({ body: '{ "kind": "manifest" }' })).toBe(
      "json"
    );
  });

  test("detects json by body starting with [ after whitespace", () => {
    expect(detectArtifactBodyKind({ body: "  [\n  1,\n  2\n]" })).toBe("json");
  });

  test("detects markdown when body starts with frontmatter fence", () => {
    expect(detectArtifactBodyKind({ body: "---\ntitle: hi\n---\n# Hello" })).toBe(
      "markdown"
    );
  });

  test("falls back to text", () => {
    expect(detectArtifactBodyKind({ body: "just some plain text" })).toBe("text");
  });

  test("falls back to text when body is missing and path is unknown", () => {
    expect(detectArtifactBodyKind({})).toBe("text");
  });

  test("path extension wins over body sniff", () => {
    expect(
      detectArtifactBodyKind({ path: "thing.md", body: '{ "x": 1 }' })
    ).toBe("markdown");
  });

  test("object body (jsonb manifest) is detected as json", () => {
    expect(
      detectArtifactBodyKind({
        body: { entry: "x", skills: { a: { path: "p", body: "y" } } },
      })
    ).toBe("json");
  });

  test("array body is detected as json", () => {
    expect(detectArtifactBodyKind({ body: [1, 2, 3] })).toBe("json");
  });
});

describe("getArtifactDisplayBody", () => {
  test("returns raw string body unchanged", () => {
    const raw = "line 1\nline 2\nline 3";
    expect(getArtifactDisplayBody({ body: raw })).toBe(raw);
  });

  test("stringifies object bodies as pretty JSON", () => {
    const result = getArtifactDisplayBody({ body: { a: 1, b: [2, 3] } });
    expect(result).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
  });

  test("returns empty string for null body", () => {
    expect(getArtifactDisplayBody({ body: null })).toBe("");
  });

  test("returns empty string for undefined body", () => {
    expect(getArtifactDisplayBody({})).toBe("");
  });

  test("does not double-stringify already-string body", () => {
    const raw = '{"already":"stringified"}';
    expect(getArtifactDisplayBody({ body: raw })).toBe(raw);
  });
});

describe("getArtifactMetadata", () => {
  test("excludes the body field", () => {
    const artifact: FactoryArtifact = {
      name: "adapter-manifest",
      version: "abcdef012345",
      sourceSha: "deadbeef",
      syncedAt: "2026-04-25T17:36:12.000Z",
      body: "huge yaml string\n…\n",
    };
    const metadata = getArtifactMetadata(artifact);
    expect(metadata).not.toHaveProperty("body");
    expect(metadata).toMatchObject({
      name: "adapter-manifest",
      version: "abcdef012345",
      sourceSha: "deadbeef",
      syncedAt: "2026-04-25T17:36:12.000Z",
    });
  });

  test("preserves arbitrary extra fields", () => {
    const metadata = getArtifactMetadata({
      name: "x",
      body: "y",
      sha: "1234",
      path: "schemas/x.schema.yaml",
    });
    expect(metadata).toEqual({
      name: "x",
      sha: "1234",
      path: "schemas/x.schema.yaml",
    });
  });
});

describe("unwrapArtifactEnvelope", () => {
  test("hoists path + body from {path, body} envelope", () => {
    const unwrapped = unwrapArtifactEnvelope({
      name: "adapter-manifest",
      body: { path: "standards/schemas/factory/adapter-manifest.schema.yaml", body: "key: value\n" },
    });
    expect(unwrapped.path).toBe("standards/schemas/factory/adapter-manifest.schema.yaml");
    expect(unwrapped.body).toBe("key: value\n");
  });

  test("does not overwrite an existing top-level path", () => {
    const unwrapped = unwrapArtifactEnvelope({
      path: "outer/path",
      body: { path: "inner/path", body: "x" },
    });
    expect(unwrapped.path).toBe("outer/path");
    expect(unwrapped.body).toBe("x");
  });

  test("leaves non-envelope bodies alone", () => {
    const original: FactoryArtifact = {
      name: "manifest",
      body: { entry: "x", skills: {} },
    };
    expect(unwrapArtifactEnvelope(original)).toEqual(original);
  });

  test("leaves string bodies alone", () => {
    const original: FactoryArtifact = { name: "x", body: "hello" };
    expect(unwrapArtifactEnvelope(original)).toEqual(original);
  });
});

describe("isSourceTabAvailable", () => {
  test("source tab is available for json (preview is pretty, source is raw)", () => {
    expect(isSourceTabAvailable("json")).toBe(true);
  });

  test("source tab is available for bundle (source shows the unmodified wrapper)", () => {
    expect(isSourceTabAvailable("bundle")).toBe(true);
  });

  test("source tab is hidden for yaml (preview already shows raw bytes)", () => {
    expect(isSourceTabAvailable("yaml")).toBe(false);
  });

  test("source tab is hidden for markdown (preview is the rendered surface)", () => {
    expect(isSourceTabAvailable("markdown")).toBe(false);
  });

  test("source tab is hidden for plain text", () => {
    expect(isSourceTabAvailable("text")).toBe(false);
  });
});

describe("detectArtifactBodyKind — bundles", () => {
  test("adapter-shaped body (orchestrator + skills with multi-line bodies) is bundle", () => {
    expect(
      detectArtifactBodyKind({
        body: {
          entry: "orchestration/template-orchestrator.md",
          orchestrator: {
            path: "orchestration/template-orchestrator.md",
            body: "# Orchestrator\n\nDoes things.",
          },
          skills: {
            scaffold: {
              path: "orchestration/skills/scaffold.md",
              body: "# Scaffold\nbody",
            },
          },
        },
      }),
    ).toBe("bundle");
  });

  test("process-shaped body (agents with multi-line bodies) is bundle", () => {
    expect(
      detectArtifactBodyKind({
        body: {
          orchestrator: {
            path: "Factory Agent/factory-orchestration.md",
            body: "# Orchestration\n\nIntro.",
          },
          stages: [
            {
              id: "s1",
              path: "Factory Agent/Orchestrator/factory-orchestration-s1.md",
              body: "# Stage 1\n\nText.",
            },
          ],
          agents: {
            controllers: [
              {
                path: "Factory Agent/Controllers/api.md",
                body: "# API\n\nTwo lines.",
              },
            ],
            client_interface: [],
          },
        },
      }),
    ).toBe("bundle");
  });

  test("plain JSON object without multi-line body fields stays json", () => {
    expect(
      detectArtifactBodyKind({
        body: { entry: "x", skills: { a: { path: "p", body: "y" } } },
      }),
    ).toBe("json");
  });

  test("array body is still json (bundles must be non-array objects)", () => {
    expect(
      detectArtifactBodyKind({
        body: [{ path: "x", body: "line1\nline2" }],
      }),
    ).toBe("json");
  });

  test("body with escape-encoded newlines also qualifies as bundle", () => {
    expect(
      detectArtifactBodyKind({
        body: {
          orchestrator: { path: "x.md", body: "# Heading\\nparagraph" },
        },
      }),
    ).toBe("bundle");
  });
});

describe("walkBundleEntries", () => {
  test("walks an adapter manifest into orchestrator + per-skill entries", () => {
    const entries = walkBundleEntries({
      entry: "orchestration/template-orchestrator.md",
      orchestrator: {
        path: "orchestration/template-orchestrator.md",
        body: "# Orchestrator\n\nbody",
      },
      skills: {
        scaffold: { path: "orchestration/skills/scaffold.md", body: "# A\nB" },
        verify: { path: "orchestration/skills/verify.md", body: "# C\nD" },
      },
      template_remote: "owner/repo",
    });

    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.path.join("."))).toEqual([
      "orchestrator",
      "skills.scaffold",
      "skills.verify",
    ]);
    expect(entries[0].body).toContain("# Orchestrator");
    expect(entries[1].body).toContain("# A");
  });

  test("walks a process definition with array agents (dotted+indexed paths)", () => {
    const entries = walkBundleEntries({
      orchestrator: {
        path: "Factory Agent/factory-orchestration.md",
        body: "# Orch\nintro",
      },
      stages: [
        {
          id: "s1",
          path: "Factory Agent/Orchestrator/factory-orchestration-s1.md",
          body: "# S1\nbody",
        },
        {
          id: "s2",
          path: "Factory Agent/Orchestrator/factory-orchestration-s2.md",
          body: "# S2\nbody",
        },
      ],
      agents: {
        client_interface: [
          {
            path: "Factory Agent/Client_Interface/a.md",
            body: "# A\nbody",
          },
          {
            path: "Factory Agent/Client_Interface/b.md",
            body: "# B\nbody",
          },
        ],
      },
    });

    expect(entries.map((e) => e.path.join("."))).toEqual([
      "orchestrator",
      "stages[0]",
      "stages[1]",
      "agents.client_interface[0]",
      "agents.client_interface[1]",
    ]);
  });

  test("uses id field as key when present, else name, else dotted path", () => {
    const entries = walkBundleEntries({
      stages: [
        { id: "s1", path: "p1.md", body: "# x\ny" },
        { name: "second", path: "p2.md", body: "# x\ny" },
        { path: "p3.md", body: "# x\ny" },
      ],
    });

    expect(entries.map((e) => e.key)).toEqual([
      "s1",
      "second",
      "stages[2]",
    ]);
  });

  test("captures name and description on the entry header data", () => {
    const entries = walkBundleEntries({
      agents: {
        controllers: [
          {
            name: "api-controller",
            description: "owns API surface",
            path: "x.md",
            body: "# x\ny",
          },
        ],
      },
    });

    expect(entries[0]).toMatchObject({
      key: "api-controller",
      name: "api-controller",
      description: "owns API surface",
      path: ["agents", "controllers[0]"],
    });
  });

  test("ignores body fields that are short scalars (not embedded documents)", () => {
    const entries = walkBundleEntries({
      config: { body: "y" },
      mode: { body: "fast" },
    });
    expect(entries).toEqual([]);
  });

  test("does not recurse into a record that is itself a body record", () => {
    const entries = walkBundleEntries({
      orchestrator: {
        path: "x.md",
        body: "# heading\n## sub",
        // even if this nested record has a body, the parent body record is the leaf
        nested: { body: "# inner\nbody" },
      },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toEqual(["orchestrator"]);
  });
});

describe("unescapeBundleBody", () => {
  test("converts literal \\n escape sequences into real newlines", () => {
    const escaped = "# Heading\\nfirst\\nsecond";
    expect(unescapeBundleBody(escaped)).toBe("# Heading\nfirst\nsecond");
  });

  test("converts literal \\r\\n escape sequences into single newlines", () => {
    const escaped = "# Heading\\r\\nfirst\\r\\nsecond";
    expect(unescapeBundleBody(escaped)).toBe("# Heading\nfirst\nsecond");
  });

  test("leaves real newlines untouched", () => {
    const real = "# Heading\nfirst\nsecond";
    expect(unescapeBundleBody(real)).toBe(real);
  });

  test("handles a mix of real and escaped sequences", () => {
    const mixed = "# heading\nparagraph one\\n\\nparagraph two";
    expect(unescapeBundleBody(mixed)).toBe(
      "# heading\nparagraph one\n\nparagraph two",
    );
  });
});

describe("end-to-end body preservation", () => {
  test("a contract envelope carrying YAML round-trips with real newlines", () => {
    const artifact = unwrapArtifactEnvelope({
      name: "adapter-manifest",
      body: {
        path: "Factory Agent/contracts/adapter-manifest.schema.yaml",
        body: "$schema: https://json-schema.org/draft/2020-12/schema\ntitle: AdapterManifest\n",
      },
    });
    expect(detectArtifactBodyKind(artifact)).toBe("yaml");
    expect(getArtifactDisplayBody(artifact)).toContain("\n");
    expect(getArtifactDisplayBody(artifact)).not.toContain("\\n");
  });
});
