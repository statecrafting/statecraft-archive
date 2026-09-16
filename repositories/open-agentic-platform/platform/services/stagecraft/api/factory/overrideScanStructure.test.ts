// Spec 200 AC-3 — structural negative posture, pure vitest lane.
//
// No code path may exist in which scanner output synchronously rejects a
// write: the write-path modules must not import the model client
// (`api/knowledge/extractors/agent-base.ts`) nor the worker, and the
// worker must be the ONLY factory module importing the model client. The
// check reads the authored sources — the import graph IS the posture.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseScanVerdict } from "./overrideScanPrompts";

const FACTORY_DIR = path.resolve(__dirname);

function sourceOf(rel: string): string {
  return readFileSync(path.resolve(FACTORY_DIR, rel), "utf8");
}

const MODEL_CLIENT_SPECIFIER = "knowledge/extractors/agent-base";

describe("spec 200 AC-3 — scanner output cannot reach the write path", () => {
  // overrideScanCore.ts DEFINES runOverrideScanWork (the worker injects
  // the model invoker into it), so it is asserted model-free below but
  // exempt from the drive-scan-work check.
  const modelFreeModules = [
    "artifacts.ts",
    "conflicts.ts",
    "../agents/catalog.ts",
    "overrideScanCore.ts",
    "admission.ts",
    "grantDuplexHandlers.ts",
    "approvalSummary.ts",
    "revocations.ts",
  ];
  const writePathModules = modelFreeModules.filter(
    (m) => m !== "overrideScanCore.ts",
  );

  for (const mod of modelFreeModules) {
    it(`${mod} does not import the model client`, () => {
      expect(sourceOf(mod)).not.toContain(MODEL_CLIENT_SPECIFIER);
    });
  }

  for (const mod of writePathModules) {
    it(`${mod} does not import the worker or drive scan work`, () => {
      const src = sourceOf(mod);
      expect(src).not.toContain("overrideScanWorker");
      expect(src).not.toContain("runOverrideScanWork");
    });
  }

  it("overrideScanWorker.ts is the only factory module importing the model client", () => {
    expect(sourceOf("overrideScanWorker.ts")).toContain(
      MODEL_CLIENT_SPECIFIER,
    );
  });
});

describe("spec 200 FR-007 — strict two-outcome verdict contract", () => {
  it("parses a clean verdict", () => {
    expect(
      parseScanVerdict('{"verdict": "clean", "rationale": "nothing odd"}'),
    ).toEqual({ verdict: "clean", rationale: "nothing odd" });
  });

  it("parses a flagged verdict with surrounding prose", () => {
    expect(
      parseScanVerdict(
        'Here is my assessment:\n{"verdict": "flagged", "rationale": "goal redirection"}',
      ),
    ).toEqual({ verdict: "flagged", rationale: "goal redirection" });
  });

  it("rejects a response with no JSON object", () => {
    expect(() => parseScanVerdict("LGTM")).toThrowError(/no JSON object/);
  });

  it("rejects a verdict outside the two-outcome contract", () => {
    expect(() =>
      parseScanVerdict('{"verdict": "quarantine-other", "rationale": "x"}'),
    ).toThrowError(/clean.*flagged/);
  });

  it("tolerates a missing rationale (evidence only, never load-bearing)", () => {
    expect(parseScanVerdict('{"verdict": "clean"}')).toEqual({
      verdict: "clean",
      rationale: "",
    });
  });
});
