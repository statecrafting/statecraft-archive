// Spec 227: transitive-dependency behaviour of the Create-project module picker.

import { describe, expect, test } from "vitest";
import { applyModuleToggle, type ModuleGraphNode } from "./module-selection";

// A -> B -> C chain plus an unrelated leaf D.
const chain: ModuleGraphNode[] = [
  { id: "a", requires: ["b"], conflicts: [] },
  { id: "b", requires: ["c"], conflicts: [] },
  { id: "c", requires: [], conflicts: [] },
  { id: "d", requires: [], conflicts: [] },
];

const sorted = (s: Set<string>) => [...s].sort();

describe("applyModuleToggle: checking pulls in transitive requires", () => {
  test("check A selects A, B, and C", () => {
    expect(sorted(applyModuleToggle(chain, new Set(), "a", true))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  test("an unrelated selection is preserved", () => {
    expect(
      sorted(applyModuleToggle(chain, new Set(["d"]), "a", true))
    ).toEqual(["a", "b", "c", "d"]);
  });

  test("does not mutate the input set", () => {
    const prev = new Set(["d"]);
    applyModuleToggle(chain, prev, "a", true);
    expect(sorted(prev)).toEqual(["d"]);
  });
});

describe("applyModuleToggle: unchecking drops transitive dependents", () => {
  test("uncheck C removes C, B, and A (the #533 nit)", () => {
    expect(
      sorted(applyModuleToggle(chain, new Set(["a", "b", "c", "d"]), "c", false))
    ).toEqual(["d"]);
  });

  test("uncheck B removes B and A but keeps C", () => {
    expect(
      sorted(applyModuleToggle(chain, new Set(["a", "b", "c"]), "b", false))
    ).toEqual(["c"]);
  });

  test("uncheck a top-level module removes only itself", () => {
    expect(
      sorted(applyModuleToggle(chain, new Set(["a", "b", "c"]), "a", false))
    ).toEqual(["b", "c"]);
  });
});

describe("applyModuleToggle: conflicts cascade to dependents", () => {
  const withConflict: ModuleGraphNode[] = [
    { id: "x", requires: [], conflicts: ["y"] },
    { id: "y", requires: [], conflicts: ["x"] },
    { id: "z", requires: ["y"], conflicts: [] },
  ];

  test("checking X drops conflicting Y (Z is left, no longer force-dropped)", () => {
    // X conflicts with Y, so Y is removed; Z (which required Y) is a separate
    // user choice and is not cascaded out by the conflict.
    expect(
      sorted(applyModuleToggle(withConflict, new Set(["y", "z"]), "x", true))
    ).toEqual(["x", "z"]);
  });

  test("a required module is never dropped by a conflict (requirement wins)", () => {
    // p requires q but also (self-contradictorily) declares a conflict with q;
    // the requirement must win so the selection stays satisfiable.
    const contradictory: ModuleGraphNode[] = [
      { id: "p", requires: ["q"], conflicts: ["q"] },
      { id: "q", requires: [], conflicts: [] },
    ];
    expect(
      sorted(applyModuleToggle(contradictory, new Set(), "p", true))
    ).toEqual(["p", "q"]);
  });
});

describe("applyModuleToggle: real acme-vue-encore graph", () => {
  // api-gateway -> security-core is the only edge in the adapter today.
  const real: ModuleGraphNode[] = [
    { id: "security-core", requires: [], conflicts: [] },
    { id: "api-gateway", requires: ["security-core"], conflicts: [] },
    { id: "data-postgres", requires: [], conflicts: [] },
    { id: "data-redis", requires: [], conflicts: [] },
    { id: "user-management", requires: [], conflicts: [] },
  ];

  test("check api-gateway pulls in security-core", () => {
    expect(
      sorted(applyModuleToggle(real, new Set(), "api-gateway", true))
    ).toEqual(["api-gateway", "security-core"]);
  });

  test("uncheck security-core drops api-gateway", () => {
    expect(
      sorted(
        applyModuleToggle(
          real,
          new Set(["api-gateway", "security-core", "user-management"]),
          "security-core",
          false
        )
      )
    ).toEqual(["user-management"]);
  });
});
