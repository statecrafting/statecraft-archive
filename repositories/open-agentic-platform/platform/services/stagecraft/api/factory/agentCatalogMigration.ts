// Spec 139 Phase 2 — agent_catalog → factory_artifact_substrate mapping
// helpers.
//
// Pulled out of `33_migrate_agent_catalog.up.sql` as pure functions so the
// OQ-1 action mapping (`agent_catalog_audit.action` →
// `factory_artifact_substrate_audit.action`) can be exercised without a
// live DB. The SQL migration uses a `CASE` expression that mirrors
// `mapAgentCatalogAuditAction` byte-for-byte; a regression test
// (`agentCatalogMigration.test.ts`) keeps them in lockstep.
//
// **OQ-1 resolution (locked Phase 2 directive):** spec 111
// `agent_catalog_audit.action='fork'` maps to a NEW substrate audit
// action `artifact.forked` rather than overloading `artifact.synced`.
// `fork` is conceptually distinct: synced = upstream wrote it; forked =
// user copied an existing artifact as a derivative seed. Spec 139 §6.4
// extended in lockstep.

import type {
  AgentCatalogAuditAction,
  AgentCatalogStatus,
  ArtifactAuditAction,
  ArtifactStatus,
} from "../db/schema";

/**
 * OQ-1 audit-action mapping. Total over the spec 111 enum.
 * Keep in lockstep with the SQL `CASE` in
 * `api/db/migrations/33_migrate_agent_catalog.up.sql` step §2.
 */
export function mapAgentCatalogAuditAction(
  source: AgentCatalogAuditAction,
): ArtifactAuditAction {
  switch (source) {
    case "create":
      // Initial create — substrate's "synced" covers the lifecycle entry
      // for both upstream-mirrored and user-authored origins.
      return "artifact.synced";
    case "edit":
      // User-edit on a draft → matches substrate's user-override action.
      return "artifact.overridden";
    case "publish":
      // Status transition; substrate captures the before/after JSONB so
      // consumers can recover the publish intent.
      return "artifact.synced";
    case "retire":
      return "artifact.retired";
    case "fork":
      // OQ-1 resolution — new action; spec 139 §6.4 extended.
      return "artifact.forked";
  }
}

/**
 * `agent_catalog.status` → `factory_artifact_substrate.status` mapping.
 * The substrate enum is binary (`active` | `retired`); spec 111's
 * `draft` and `published` collapse into `active` (the substrate doesn't
 * model publication state — that's surfaced via the audit log instead).
 */
export function mapAgentCatalogStatus(
  source: AgentCatalogStatus,
): ArtifactStatus {
  return source === "retired" ? "retired" : "active";
}

/**
 * Compose the substrate path for a user-authored agent. Stable shape so
 * the migration's UNIQUE (org_id, origin, path, version) lands cleanly.
 */
export function userAuthoredAgentPath(name: string): string {
  return `user-authored/${name}.md`;
}
