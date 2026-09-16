// Spec 139 Phase 2 — T040 split into:
//
//   (a) Pure-functional action / status / path mapping tests (run under
//       `npm test` — they have no DB dependency).
//   (b) DB-bound dry-run that snapshots `agent_catalog`,
//       `agent_catalog_audit`, and `project_agent_bindings`, runs migration
//       33, and asserts byte-equal `content_hash` + `frontmatter` on every
//       row. The DB-bound test is gated to `encore test` via the
//       `vite.config.ts` exclude list (matching the spec 124
//       `runsMigration.test.ts` pattern).
//
// The pure-functional tests are the load-bearing OQ-1 regression check —
// they pin the mapping table that the migration's SQL `CASE` mirrors.

import { describe, expect, test } from "vitest";
import {
  mapAgentCatalogAuditAction,
  mapAgentCatalogStatus,
  userAuthoredAgentPath,
} from "./agentCatalogMigration";
import type {
  AgentCatalogAuditAction,
  AgentCatalogStatus,
} from "../db/schema";

describe("spec 139 Phase 2 — agent_catalog migration mapping (T040 pure)", () => {
  test("OQ-1 action mapping is total and stable", () => {
    const expected: Record<AgentCatalogAuditAction, string> = {
      create: "artifact.synced",
      edit: "artifact.overridden",
      publish: "artifact.synced",
      retire: "artifact.retired",
      fork: "artifact.forked",
    };
    for (const [src, dst] of Object.entries(expected)) {
      expect(mapAgentCatalogAuditAction(src as AgentCatalogAuditAction)).toBe(
        dst,
      );
    }
  });

  test("status mapping collapses draft + published into active", () => {
    const expected: Record<AgentCatalogStatus, string> = {
      draft: "active",
      published: "active",
      retired: "retired",
    };
    for (const [src, dst] of Object.entries(expected)) {
      expect(mapAgentCatalogStatus(src as AgentCatalogStatus)).toBe(dst);
    }
  });

  test("path is stable and POSIX", () => {
    expect(userAuthoredAgentPath("svc-audience-identification")).toBe(
      "user-authored/svc-audience-identification.md",
    );
    // Names with hyphens, underscores, dots all carry through verbatim —
    // the migration does the same, so the unique index lands the same way.
    expect(userAuthoredAgentPath("api_builder.v2")).toBe(
      "user-authored/api_builder.v2.md",
    );
  });

  test("artifact.forked is a recognised audit action (spec 139 §6.4 extended)", () => {
    // This is a narrow check that the closed-set type accepts the new
    // value — if a future refactor drops `artifact.forked`, this breaks
    // before the SQL CHECK constraint catches it at runtime.
    const v: ReturnType<typeof mapAgentCatalogAuditAction> =
      mapAgentCatalogAuditAction("fork");
    expect(v).toBe("artifact.forked");
  });
});
