// Spec 163 §2.2 / FR-003 — derived-group projection unit tests.

import { describe, expect, test } from "vitest";
import { buildDerivedGroups } from "./spec-registry-grouping";
import type { SpecListRow } from "../../../api/specRegistry/types";

function row(
  id: string,
  overrides: Partial<SpecListRow> = {}
): SpecListRow {
  return {
    id,
    title: `Spec ${id}`,
    status: "approved",
    implementation: "complete",
    kind: "platform",
    categories: [],
    risk: null,
    owner: null,
    summary: null,
    specPath: `specs/${id}/spec.md`,
    extraFrontmatter: {},
    relationshipFields: {},
    hasDecompositionOrigin: false,
    ...overrides,
  };
}

describe("buildDerivedGroups by-category", () => {
  test("clusters specs sharing a category and shows category labels (SC-002)", () => {
    const specs = [
      row("001-a", { categories: ["lifecycle"] }),
      row("002-b", { categories: ["lifecycle", "auth"] }),
      row("003-c", { categories: ["auth"] }),
      row("004-d", {}),
    ];
    const groups = buildDerivedGroups(specs, "by-category");
    const auth = groups.find((g) => g.label === "auth");
    const lifecycle = groups.find((g) => g.label === "lifecycle");
    expect(auth?.specs.map((s) => s.id)).toEqual(["002-b", "003-c"]);
    expect(lifecycle?.specs.map((s) => s.id)).toEqual(["001-a", "002-b"]);
    // Specs with no category fall into Ungrouped.
    const ungrouped = groups.find((g) => g.label === "Ungrouped");
    expect(ungrouped?.specs.map((s) => s.id)).toEqual(["004-d"]);
  });

  test("returns no groups when no specs carry a category", () => {
    const groups = buildDerivedGroups([row("001-a"), row("002-b")], "by-category");
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Ungrouped");
  });
});

describe("buildDerivedGroups by-supersession-chain", () => {
  test("clusters specs linked by supersedes edges (SC-003)", () => {
    const specs = [
      row("042-old", {}),
      row("088-newer", {
        relationshipFields: { supersedes: [{ spec: "042-old" }] },
      }),
      row("100-newest", {
        relationshipFields: { supersedes: [{ spec: "088-newer" }] },
      }),
      row("200-unrelated", {}),
    ];
    const groups = buildDerivedGroups(specs, "by-supersession-chain");
    const chain = groups.find((g) => g.specs.some((s) => s.id === "042-old"));
    expect(chain).toBeDefined();
    expect(chain!.specs.map((s) => s.id)).toEqual(["042-old", "088-newer", "100-newest"]);
    // 200-unrelated is a singleton — it lands in Ungrouped.
    const ungrouped = groups.find((g) => g.label === "Ungrouped");
    expect(ungrouped?.specs.map((s) => s.id)).toEqual(["200-unrelated"]);
  });

  test("accepts bare-string id refs as well as { spec } objects", () => {
    const specs = [
      row("042-old"),
      row("088-newer", {
        relationshipFields: { supersedes: ["042"] },
      }),
    ];
    const groups = buildDerivedGroups(specs, "by-supersession-chain");
    expect(groups[0].specs.map((s) => s.id)).toEqual(["042-old", "088-newer"]);
  });
});

describe("buildDerivedGroups by-establishment-chain", () => {
  test("clusters specs sharing establishment lineage", () => {
    const specs = [
      row("001-base"),
      row("010-ext", {
        relationshipFields: { extends: [{ spec: "001-base" }] },
      }),
      row("020-ext", {
        relationshipFields: { extends: [{ spec: "010-ext" }] },
      }),
      row("999-alone"),
    ];
    const groups = buildDerivedGroups(specs, "by-establishment-chain");
    const chain = groups.find((g) => g.specs.some((s) => s.id === "001-base"));
    expect(chain).toBeDefined();
    expect(chain!.specs.map((s) => s.id)).toEqual(["001-base", "010-ext", "020-ext"]);
  });
});
