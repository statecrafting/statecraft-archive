// Spec 140 §2.3 / T050 + T051 — scaffoldReadiness response shape +
// blocker-resolution unit tests.
//
// T050: assert the response type carries no `hasTemplateRemote` field
// (top-level or per-adapter); `createEligible` is purely
// `scaffoldSourceResolved`.
//
// T051: pin the blocker-resolution table — `stale-adapter-manifest`
// fires only when no adapter declares `scaffold_source_id`;
// `no-scaffold-source-resolved` fires when at least one declares but
// none resolves.
//
// The endpoint itself depends on Encore auth + DB so a full handler
// test is encore-gated. The pure resolver (`resolveBlocker`) exported
// from `scaffoldReadiness.ts` is what spec 140 §2.3 demands; this is
// where the per-blocker logic lives.

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBlocker } from "./scaffoldReadinessBlocker";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, "scaffoldReadiness.ts"), "utf8");
const WEB_API = readFileSync(
  join(HERE, "..", "..", "web", "app", "lib", "projects-api.server.ts"),
  "utf8",
);

describe("spec 140 §2.3 — scaffoldReadiness response shape (T050)", () => {
  test("AdapterReadinessVerdict no longer declares hasTemplateRemote — source pin", () => {
    expect(SOURCE).not.toMatch(/hasTemplateRemote/);
  });

  test("ScaffoldReadinessResponse no longer declares hasTemplateRemote — source pin", () => {
    // The interface text in scaffoldReadiness.ts is the wire-shape
    // definition; absence of the field there is what the API returns.
    const interfaceBody =
      SOURCE.match(/export interface ScaffoldReadinessResponse[\s\S]*?\n\}/)?.[0] ??
      "";
    expect(interfaceBody).not.toContain("hasTemplateRemote");
    expect(interfaceBody).toContain("scaffoldSourceResolved");
  });

  test("web client type for ScaffoldReadiness no longer declares hasTemplateRemote", () => {
    const interfaceBody =
      WEB_API.match(/export interface ScaffoldReadiness[\s\S]*?\n\}/)?.[0] ?? "";
    expect(interfaceBody).not.toContain("hasTemplateRemote");
  });

  test("scaffoldReadiness.ts has no production read of manifest.template_remote", () => {
    const code = SOURCE
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|\s)\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/template_remote/);
  });
});

describe("spec 140 §2.3 — blocker resolution (T051)", () => {
  const baseInputs = {
    hasFactoryAdapter: true,
    anyDeclaresScaffoldSource: true,
    scaffoldSourceResolved: true,
    hasUpstreamPat: true,
    warmupReady: true,
    warmupError: undefined,
  };

  test("no adapters → 'no-factory-adapter'", () => {
    expect(resolveBlocker({ ...baseInputs, hasFactoryAdapter: false })).toBe(
      "no-factory-adapter",
    );
  });

  test("adapters present, none declares scaffold_source_id → 'stale-adapter-manifest'", () => {
    // This is the spec 140 §2.3 simplified case: the legacy
    // `template_remote` fallback is gone, so an adapter row that lacks
    // `scaffold_source_id` outright is the trigger.
    expect(
      resolveBlocker({
        ...baseInputs,
        anyDeclaresScaffoldSource: false,
        scaffoldSourceResolved: false,
      }),
    ).toBe("stale-adapter-manifest");
  });

  test("at least one adapter declares scaffold_source_id, none resolves → 'no-scaffold-source-resolved'", () => {
    expect(
      resolveBlocker({
        ...baseInputs,
        anyDeclaresScaffoldSource: true,
        scaffoldSourceResolved: false,
      }),
    ).toBe("no-scaffold-source-resolved");
  });

  test("scaffold source resolved, no PAT is not a blocker (anonymous clone)", () => {
    expect(
      resolveBlocker({ ...baseInputs, hasUpstreamPat: false }),
    ).toBeUndefined();
  });

  test("everything resolved, warmup error surfaces 'warmup-error'", () => {
    expect(
      resolveBlocker({ ...baseInputs, warmupError: "init failed" }),
    ).toBe("warmup-error");
  });

  test("everything resolved, warmup not yet ready surfaces 'warming-up'", () => {
    expect(
      resolveBlocker({ ...baseInputs, warmupReady: false }),
    ).toBe("warming-up");
  });

  test("everything green → no blocker", () => {
    expect(resolveBlocker(baseInputs)).toBeUndefined();
  });
});
