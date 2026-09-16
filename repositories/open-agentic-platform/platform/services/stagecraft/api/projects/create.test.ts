// Spec 199 FR-009 (supersedes spec 140 §2.2 partial) — pin the
// failedPrecondition message wording.
//
// `create.ts`'s scaffold-source gate produces user-visible
// `APIError.failedPrecondition` strings that the readiness banners and
// error-toaster surface verbatim. The scaffold source is resolved at
// ADMISSION time (spec 198 / 199 D-5) from the manifest's org-agnostic
// `scaffold.source.remote`; the create path reads the admission record.
// These pins assert the strings reference the admission-record flow and
// that no production code reads the retired injected fields
// (`scaffold_source_id` flat manifest field, legacy `template_remote`).
//
// A behavioural test would require seeding an org + an admission record,
// which crosses into Encore-runtime + DB territory. The string-pinning
// shape below is proportional: it locks the message at refactor time and
// surfaces regressions without requiring an integration harness.

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CREATE_TS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "create.ts"),
  "utf8",
);

describe("spec 199 FR-009 — create.ts precondition messages", () => {
  test("the missing-resolution message points at the admission record", () => {
    expect(CREATE_TS).toContain(
      "has no scaffold-source resolution on its admission record",
    );
    expect(CREATE_TS).not.toMatch(/has no template_remote in its manifest/);
  });

  test("the unresolved-upstream message points at /app/factory/upstreams + re-sync", () => {
    expect(CREATE_TS).toContain("no factory_upstreams row matches");
    expect(CREATE_TS).toContain("/app/factory/upstreams");
    expect(CREATE_TS).toContain("re-run /factory-sync");
  });

  test("binding is admission-gated (spec 198 FR-001)", () => {
    expect(CREATE_TS).toContain("cannot be bound");
    expect(CREATE_TS).toContain("isFactoryAdmitted");
  });

  test("create.ts no longer reads the retired injected fields in production code", () => {
    // Comments are allowed (this is a pin against runtime reads); strip
    // single- and multi-line comments before checking.
    const code = CREATE_TS
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|\s)\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/manifest\.template_remote/);
    expect(code).not.toMatch(/manifest\.template_default_branch/);
    expect(code).not.toMatch(/scaffold_source_id/);
  });
});
