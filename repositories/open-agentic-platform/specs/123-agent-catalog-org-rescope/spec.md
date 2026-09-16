---
id: "123-agent-catalog-org-rescope"
slug: agent-catalog-org-rescope
title: Agent Catalog Org-Rescope — Projects Consume, Org Governs
status: approved
implementation: complete
owner: bart
created: "2026-05-01"
amended: "2026-05-05"
amendment_record: "139-factory-artifact-substrate"
kind: governance
domain: platform
risk: high
depends_on:
  - "042-multi-provider-agent-registry"  # multi-provider-agent-registry
  - "054-agent-frontmatter-schema"  # agent-frontmatter-schema (UnifiedFrontmatter)
  - "068-permission-runtime"  # permission-runtime
  - "075-factory-workflow-engine"  # factory-workflow-engine (primary agent consumer)
  - "087-unified-workspace-architecture"  # unified-project-architecture (duplex sync substrate)
  - "090-governance-non-optionality"  # governance-non-optionality
  - "098-governance-enforcement-stitching"  # governance-enforcement-stitching (audit trail composition)
  - "108-factory-as-platform-feature"  # factory-as-platform-feature (org-level Factory baseline)
  - "111-org-agent-catalog-sync"  # org-agent-catalog-sync (the original org-level design)
  - "119-project-as-unit-of-governance"  # project-as-unit-of-governance (amended scope)
  - "122-stakeholder-doc-inversion"  # stakeholder-doc-inversion (Stage CD comparator agent reference)
amends:
  - "119-project-as-unit-of-governance"
code_aliases: ["AGENT_CATALOG_ORG"]
establishes:
extends:
  - spec: "119-project-as-unit-of-governance"
    nature: wrapping
    unit: { kind: file, path: platform/services/statecraft/api/agents/catalog.ts }
  - spec: "119-project-as-unit-of-governance"
    nature: wrapping
    unit: { kind: file, path: platform/services/statecraft/api/agents/relay.ts }
  - spec: "119-project-as-unit-of-governance"
    nature: wrapping
    unit: { kind: file, path: platform/services/statecraft/api/agents/bindings.ts }
  - spec: "119-project-as-unit-of-governance"
    nature: wrapping
    unit: { kind: file, path: platform/services/statecraft/api/sync/duplex.ts }
  - spec: "119-project-as-unit-of-governance"
    nature: wrapping
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.agents._index.tsx }
  - spec: "119-project-as-unit-of-governance"
    nature: wrapping
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.agents.tsx }
  - spec: "119-project-as-unit-of-governance"
    nature: wrapping
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.agents.new.tsx }
  - spec: "119-project-as-unit-of-governance"
    nature: wrapping
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.agents.$agentId.tsx }
  - spec: "119-project-as-unit-of-governance"
    nature: wrapping
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.agents.$agentId.publish.tsx }
  - spec: "119-project-as-unit-of-governance"
    nature: wrapping
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.agents.$agentId.history.tsx }
  - spec: "119-project-as-unit-of-governance"
    nature: wrapping
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.project.$projectId.agents._index.tsx }
  - spec: "119-project-as-unit-of-governance"
    nature: wrapping
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.project.$projectId.agents.tsx }
  - spec: "119-project-as-unit-of-governance"
    nature: wrapping
    unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/agent_catalog_sync.rs }
  - spec: "119-project-as-unit-of-governance"
    nature: wrapping
    unit: { kind: file, path: crates/factory-engine/src/agent_resolver.rs }
summary: >
  Move the agent catalog back to org scope. Spec 119 collapsed workspace into
  project and rescoped agents to project_id along with knowledge, runs, grants,
  and connectors; the rescoping was correct for project-cohabiting data but
  wrong for agents, which are reusable governed capabilities consumed by
  org-level surfaces (Factory, policy bundles, audit). This spec amends 119
  to restore agents to org scope without disturbing the rest of the collapse.
  Projects become catalog *consumers* via a `project_agent_bindings` join
  table that pins an org agent at a specific version. No per-binding
  override of the agent definition: bespoke needs fork a new org agent.
  Duplex sync (spec 111 §7) snaps back to org-scoped envelopes for the
  catalog itself; project-binding deltas flow as a separate envelope.
---

# 123 — Agent Catalog Org-Rescope

> **Amended 2026-05-05 by spec [139](../139-factory-artifact-substrate/spec.md).**
> The `project_agent_bindings` mechanism generalises into universal
> `factory_bindings` — same shape (`(pinned_version, pinned_content_hash)`),
> applied to any kind. Invariants I-B1..I-B4 (no definition override,
> pin integrity, retired-readability, ON DELETE RESTRICT) carry over
> verbatim. The mirror migration lands in spec 139 Phase 2 (T052); the
> legacy table is dropped by migration 35 (Phase 4b), with
> `api/agents/bindings.ts` substrate-direct on read and write. See
> [implementation-audit.md](./implementation-audit.md) for the cutover
> trail.

**Feature Branch:** `123-agent-catalog-org-rescope`
**Created:** 2026-05-01
**Status:** Draft
**Input:** "There should be an org-level Agents functionality (like Factory). Project agents import from the org and are aggregated/controlled at the org level, consumed at the project level."

## 1. Problem

Spec 111 (`org-agent-catalog-sync`, approved 2026-04-21, implementation complete) established agents as an organisational asset stored in statecraft (`agent_catalog.workspace_id`) and pushed to OPC desktops via the duplex channel (spec 087 §5.3). Spec 119 (`project-as-unit-of-governance`, 2026-04-29) then collapsed `workspace` into `project` across the platform; migration `27_collapse_workspace_into_project` and the rewrite of `platform/services/statecraft/api/agents/catalog.ts` (banner: *"Spec 119: agents are project-scoped"*) carried agents along with knowledge, runs, grants, connectors, and S3 bucket ownership into project scope.

The collapse was correct for **project-cohabiting data** — knowledge, sync runs, extraction outputs, and storage all bind to a single project's lifecycle and are duplicated by the clone pipeline (specs 113/114). It was wrong for **agents**, whose consumers and governance line live at org scope.

### 1.1 Symptoms of the mismatch

1. **Statecraft dashboard has no top-level Agents surface.** Projects and Factory live as org-level tabs; agents are buried under `app.project.$projectId.agents`. Operators looking for "the org's agent inventory" cannot find one because it does not exist as a first-class concept.
2. **Factory→agent references lose stable identity.** Factory pipelines (org-scoped per spec 108) need to say *"stage 3 uses `extractor@v7`."* With agents under `project_id`, the same name resolves to a different row per project — or no row at all when a pipeline runs against a fresh project. The runtime is forced into late-binding by *role* and version pinning is impossible. Spec 111 §1 named this exact problem; 119 reinstated it.
3. **Cross-project Factory comparisons are contaminated.** Stage CD comparator (spec 122) and the Stage CD diff classification grammar are designed to surface behavioural drift between runs of the same pipeline against multiple projects. Per-project agent definitions inject definition drift on top of behavioural drift; the signal channel is no longer pure.
4. **Two governance pipes.** Policy bundles, tool allowlists, safety tiers, and audit retention attach to the entity being governed. With Factory at org scope and agents at project scope, every governance feature has to traverse the seam: org policy must reach project-scoped agents (or fail to), and project policy must coordinate with org-scoped Factory pipelines (or fail to).
5. **Cloning duplicates agent definitions.** Spec 119's central justification was that the clone pipeline copies knowledge cleanly. Cloning *agents* the same way produces N divergent copies of what should be one governed definition; a later prompt fix or tool retraction must chase every clone.
6. **The `.claude/agents/` mental model breaks.** Spec 111 §2.4 designated remote-shadowed-by-local merge semantics keyed on workspace context. Project-scoped catalog has no equivalent inheritance edge — every project starts empty.

### 1.2 What 119 still gets right

The rest of 119 stands. Knowledge, sync runs, extraction runs, clone runs, source connectors, S3 buckets, members, and grants all rightly cohabit with a single project's lifecycle. The `workspaces` table drop, the `document_bindings` drop, the `org → project` flattening, the unified `project_grants` precedence rule (§6.4), and the `amends:` / `amendment_record:` frontmatter convention introduced in 119 §7 all remain operative. **This spec amends 119 narrowly** — the agent-catalog scoping decision only — and uses 119's own amendment grammar to do so.

## 2. Decision

Restore agents to **org scope**, with projects as pinned consumers.

1. **`agent_catalog` is keyed by `org_id`**, not `project_id`. Names are unique per `(org_id, name)`; versions monotonic per `(org_id, name)`.
2. **Projects consume via a join table `project_agent_bindings`** that pins one org agent at one version per project. The binding row carries no override of the agent definition (frontmatter, body, tools, model). Bespoke project needs are addressed by forking the org agent into a new org agent (a one-line action in the catalog UI), not by per-project edits.
3. **Top-nav `Agents` surface** in statecraft, sibling of `Projects` and `Factory`. Owns the authoring, version history, publish/retire, and governance UI. The `Factory` tab and the `Projects` tab keep their current placement.
4. **Project `Agents` tab** stays where it is in the project nav, but its semantics change from authoring to consumption: it lists the project's bindings, exposes `bind / unbind / change-pinned-version` actions, and links out to the org catalog page for definition viewing.
5. **Duplex sync (spec 087 §5.3, spec 111 §7) snaps back to org scope** for the catalog itself. A separate envelope variant carries project-binding deltas.
6. **`workspace_id` does not return.** Org is the right scope; we do not re-introduce a layer between organization and project.

### 2.1 Why "no overrides" is non-negotiable

Allowing per-binding override of any agent field re-introduces every problem this spec exists to solve. Audits would have to compose two rows to determine what actually ran. Factory pipelines pinning an agent version would still see different behaviour per project. Governance policy attached to the org-level agent could be silently undermined by project-level overrides. The tradeoff — slightly heavier authoring path for project-specific variants — is acceptable: forking an org agent is one click in the UI and produces a properly governed, separately-versioned definition. The bright governance line is worth the extra row.

## 3. Scope of Amendment to Spec 119

Per the convention 119 §7 introduced, this spec carries `amends: ["119"]` and 119 receives `amended: "2026-05-01"`, `amendment_record: "123"`, and a callout in its body. The amendment is narrow:

| 119 element | Status under this amendment |
|---|---|
| Workspace → project collapse (§2) | **Stands.** |
| `workspaces` table drop (§4.1) | **Stands.** |
| `document_bindings` drop (§4.1) | **Stands.** |
| `knowledge_objects.project_id` (§4.3) | **Stands.** |
| `source_connectors.project_id` (§4.3) | **Stands.** |
| `sync_runs.project_id` (§4.3) | **Stands.** |
| `knowledge_extraction_runs.project_id` (§4.3) | **Stands.** |
| `clone_runs.project_id` (§4.3) | **Stands.** |
| `agent_policies.project_id` (§4.3) | **No-op (already org-scoped).** Implementation discovery: `agent_policies` was created in migration 4 with `org_id` and was never actually project-scoped — the spec 119 collapse did not touch it. The §4.3 SQL block from this spec is therefore omitted from migration 30. Policy attaches to the org-level catalog as intended; per-project policy attaches to bindings, not definitions. |
| `agent_catalog.project_id` (implicit via migration 27) | **Reverted to `org_id`.** See §4. |
| `agent_catalog_audit.project_id` (implicit via migration 27) | **Reverted to `org_id`.** See §4. |
| `project_grants` merge (§6.4) | **Stands.** Tool-permission governance for runtime stays project-scoped; agent *catalog* governance is org-scoped. |
| Code-alias migration (§5) | **Stands.** No further alias renames in this spec; `AGENT_CATALOG_ORG` is a new alias, not a rename. |
| `amends:` / `amendment_record:` frontmatter convention (§7) | **Stands.** This spec exercises the convention for the second time. |
| Invariant I-3 (no `workspace` symbol post-cutover) | **Stands.** This spec uses `org_id`, not workspace. |
| Invariant I-4 (no `workspace` mentions in specs) | **Stands.** No new workspace references introduced here. |

## 4. Data Model

### 4.1 `agent_catalog` — keyed by org

```sql
ALTER TABLE agent_catalog
    ADD COLUMN org_id TEXT NOT NULL DEFAULT 'default';

-- Backfill: every existing project_id resolves to its project's org_id.
UPDATE agent_catalog ac
   SET org_id = p.org_id
  FROM projects p
 WHERE p.id = ac.project_id;

ALTER TABLE agent_catalog ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE agent_catalog DROP COLUMN project_id;

ALTER TABLE agent_catalog
    DROP CONSTRAINT agent_catalog_project_id_name_version_key;  -- name from migration 27
ALTER TABLE agent_catalog
    ADD CONSTRAINT agent_catalog_org_id_name_version_key
        UNIQUE (org_id, name, version);

DROP INDEX agent_catalog_proj_name_idx;
DROP INDEX agent_catalog_proj_status_idx;
CREATE INDEX agent_catalog_org_name_idx ON agent_catalog (org_id, name);
CREATE INDEX agent_catalog_org_status_idx ON agent_catalog (org_id, status);
```

### 4.2 `agent_catalog_audit` — same rescope

```sql
ALTER TABLE agent_catalog_audit
    ADD COLUMN org_id TEXT NOT NULL DEFAULT 'default';
UPDATE agent_catalog_audit a
   SET org_id = p.org_id
  FROM projects p
 WHERE p.id = a.project_id;
ALTER TABLE agent_catalog_audit ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE agent_catalog_audit DROP COLUMN project_id;
DROP INDEX agent_catalog_audit_proj_idx;
CREATE INDEX agent_catalog_audit_org_idx ON agent_catalog_audit (org_id, created_at DESC);
```

### 4.3 `agent_policies` — no-op (reconciled at implementation time)

> **Implementation note (2026-05-01):** the SQL block originally drafted in
> this section assumed `agent_policies` was migrated to `project_id` by
> spec 119. In reality migration 4 created `agent_policies` with `org_id`
> and `UNIQUE (org_id, slug)`, and the spec 119 collapse (migrations 27,
> 28, 29) never touched it. Migration 30 therefore omits this SQL block
> entirely; the table is already in the target shape. Authoritative
> record: the migration file
> `platform/services/statecraft/api/db/migrations/30_agent_catalog_org_rescope.up.sql`
> header comment.

### 4.4 `project_agent_bindings` — new join table

```sql
CREATE TABLE project_agent_bindings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    org_agent_id    UUID NOT NULL REFERENCES agent_catalog(id) ON DELETE RESTRICT,
    pinned_version  INTEGER NOT NULL,
    pinned_content_hash TEXT NOT NULL,
    bound_by        UUID NOT NULL REFERENCES users(id),
    bound_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, org_agent_id)
);

CREATE INDEX project_agent_bindings_project_idx ON project_agent_bindings (project_id);
CREATE INDEX project_agent_bindings_agent_idx ON project_agent_bindings (org_agent_id);
```

Invariants:

- I-B1. **No definition override.** The binding row carries `pinned_version` and `pinned_content_hash` only — no frontmatter, body, tool, or model field. Project-specific behaviour requires a fork.
- I-B2. **Pin integrity.** `pinned_content_hash` MUST match the `content_hash` of the `agent_catalog` row addressed by `(org_agent_id, pinned_version)` at bind time. Validated at write; re-validated by a nightly integrity check (spec 098).
- I-B3. **Retired-agent bindings are read-only.** When an org agent is retired, existing bindings are not auto-deleted; they remain visible with a `status: retired_upstream` indicator and cannot be re-pinned to a new version (rebind requires choosing a non-retired agent).
- I-B4. **`ON DELETE RESTRICT`.** The org agent cannot be hard-deleted while bindings exist. Retire instead.

### 4.5 Backfill of bindings from prior project-scoped catalog

Projects that authored agents under the 119 regime (between migration 27 and this spec) carry per-project rows in `agent_catalog`. The migration:

1. **Deduplicate by content.** Group `agent_catalog` rows by `(org_id, name, content_hash)` after the org_id backfill in §4.1. Each group becomes one canonical org-level row (the lowest `id` wins).
2. **Materialise bindings.** For every absorbed row, insert a `project_agent_bindings` row pointing the project at the canonical row's `(id, version, content_hash)`.
3. **Drop the absorbed rows.** Only the canonical row survives in `agent_catalog`.

The migration log records every absorption and binding for replay/audit.

## 5. API Surface

### 5.1 Org catalog endpoints

```
POST   /api/orgs/:orgId/agents              -- create draft
GET    /api/orgs/:orgId/agents              -- list (?status=, ?q=)
GET    /api/orgs/:orgId/agents/:id          -- detail
PATCH  /api/orgs/:orgId/agents/:id          -- edit draft
POST   /api/orgs/:orgId/agents/:id/publish  -- bump version, sync to OPCs
POST   /api/orgs/:orgId/agents/:id/retire   -- mark retired, propagate
POST   /api/orgs/:orgId/agents/:id/fork     -- copy into new draft (new name)
GET    /api/orgs/:orgId/agents/:id/history  -- audit trail
```

RBAC: any org member can read; publish / retire / fork require `org:agents:publish` (new role) or `org:admin`.

### 5.2 Project binding endpoints

```
GET    /api/projects/:projectId/agents               -- list bindings
POST   /api/projects/:projectId/agents/bind          -- { org_agent_id, version }
PATCH  /api/projects/:projectId/agents/:bindingId    -- repin to new version
DELETE /api/projects/:projectId/agents/:bindingId    -- unbind
```

The binding endpoint resolves `version` to a concrete `content_hash` server-side and writes both atomically. Repinning to a retired version is rejected (I-B3).

### 5.3 Removed endpoints

The 119-era project-scoped CRUD for agent definitions (`POST /api/projects/:projectId/agents` with body, `PATCH /api/projects/:projectId/agents/:id`, etc.) is removed. The route at `/api/projects/:projectId/agents` is repurposed to list bindings (5.2).

## 6. Web UI

### 6.1 New top-nav surface

`platform/services/statecraft/web/app/routes/app.tsx` nav adds:

```ts
{ to: "/app/agents", label: "Agents", end: false }
```

Order in the nav: `Projects`, `Agents`, `Factory`. Rationale — agents sit conceptually between projects (which import them) and Factory (which runs them). Renderer is `app.agents.tsx` (layout) with nested:

- `app.agents._index.tsx` — list (draft / published / retired filters, search by name / tag / model).
- `app.agents.new.tsx` — create draft.
- `app.agents.$agentId.tsx` — detail + frontmatter / body editor (as 111 §2.5).
- `app.agents.$agentId.publish.tsx` — publish modal (policy bundle, lint gate).
- `app.agents.$agentId.history.tsx` — version history from `agent_catalog_audit`.

### 6.2 Project consumer surface

`app.project.$projectId.agents._index.tsx` is rewritten as a binding manager:

- Lists current bindings: `name @ vN (content_hash:abc1234)`, retire-upstream indicator if applicable, last-bound timestamp + actor.
- "Add binding" picker (modal) lists org agents not yet bound to the project; selecting one shows version history and lets the operator pin a specific version (default: latest published).
- "Repin" action on each binding row.
- "Unbind" action with confirmation.
- Definition view for a binding deep-links to `/app/agents/:agentId` (org catalog).

The 119-era `app.project.$projectId.agents.new.tsx` and `agents.$agentId.publish.tsx` are deleted (authoring moves to org).

### 6.3 OPC desktop consumption

Desktop continues to maintain the local SQLite cache (spec 111 §2.4) but rebinds to org scope:

- `agents.workspace_id` → `agents.org_id` on the desktop side (column rename).
- The "active project" selection on the desktop determines which subset of the org catalog is *active* (the bound subset) versus *visible* (the full org catalog). Active subset is what `Agent.list()` returns by default; full catalog is exposed via "browse org agents" affordance for ad-hoc invocation.
- `.claude/agents/*.md` files retain the spec 111 §2.4 behaviour (`source: "file"`, project-local).

## 7. Duplex Envelopes

### 7.1 Catalog envelopes (spec 111 §2.3, rescoped)

```ts
interface AgentCatalogUpdated {
  v: 2;                          // bump from 1 — org_id replaces workspace_id
  kind: "agent.catalog.updated";
  event_id: string;
  org_id: string;
  agent_id: string;
  name: string;
  version: number;
  status: "published" | "retired";
  content_hash: string;
  frontmatter: UnifiedFrontmatter;
  body_markdown: string;
  updated_at: string;
}

interface AgentCatalogSnapshot {
  v: 2;
  kind: "agent.catalog.snapshot";
  event_id: string;
  org_id: string;
  entries: Array<{
    agent_id: string;
    name: string;
    version: number;
    status: "published" | "retired";
    content_hash: string;
  }>;
}
```

### 7.2 New: project-binding envelopes

```ts
interface ProjectAgentBindingUpdated {
  v: 1;
  kind: "project.agent_binding.updated";
  event_id: string;
  org_id: string;
  project_id: string;
  binding_id: string;
  org_agent_id: string;
  pinned_version: number;
  pinned_content_hash: string;
  action: "bound" | "rebound" | "unbound";
  bound_at: string;
}

interface ProjectAgentBindingSnapshot {
  v: 1;
  kind: "project.agent_binding.snapshot";
  event_id: string;
  org_id: string;
  project_id: string;
  bindings: Array<{
    binding_id: string;
    org_agent_id: string;
    pinned_version: number;
    pinned_content_hash: string;
  }>;
}
```

The catalog envelope and the binding envelope are independent: catalog updates fan out to all OPCs of the org; binding updates fan out only to OPCs that have the project active.

### 7.3 Schema-version handling

The bump from `v: 1` (spec 111) to `v: 2` is a clean break per pre-alpha posture (no users). Desktops that have not received the schema update reject `v: 2` envelopes and surface a "statecraft requires desktop update" toast. Compile-time schema-version constants (per the embedded-schema-version feedback) make the version mismatch a build error if a desktop ships out of sync with the platform.

## 8. Code Surface

### 8.1 Statecraft API

- `platform/services/statecraft/api/agents/catalog.ts` — rewrite for org scope. Banner updated: *"Spec 123: agents are org-scoped; projects consume via bindings."*
- `platform/services/statecraft/api/agents/bindings.ts` — new module for the project-binding endpoints.
- `platform/services/statecraft/api/agents/relay.ts` — duplex envelope routing updated for v2 catalog + v1 binding envelopes.
- `platform/services/statecraft/api/sync/duplex.ts` — register the binding envelope kinds.

### 8.2 Factory engine

- `crates/factory-engine/src/agent_resolver.rs` — new module. Resolves a Factory pipeline's agent reference (`{org_agent_id, version}` or `{name, version}`) against the org catalog. Replaces the current implicit per-run resolution.
- `crates/factory-engine/src/stages/stage_cd_comparator.rs` — no semantic change, but the agent reference passes through `agent_resolver` so two runs against two projects use the same agent definition by hash.

### 8.3 Desktop

- `product/apps/opc/src-tauri/src/commands/agent_catalog_sync.rs` — schema bump for v2 envelopes; org-keyed cache table.
- `product/apps/opc/src-tauri/src/commands/agents.rs` — add binding-aware `list_active_agents(project_id)` returning org agents with bindings to the active project, plus `list_org_agents(org_id)` for ad-hoc browse.

## 9. Migration

### 9.1 Pre-flight

- Snapshot DB (existing tooling).
- Assert no inflight `agent_catalog` writes (no draft mid-edit; check `updated_at` quiescence window or pause writes).
- Inventory: count distinct `(name, content_hash)` pairs across projects to predict deduplication ratio. The migration log records the predicted vs. actual.

### 9.2 Cutover (single migration `30_agent_catalog_org_rescope`)

1. Add `org_id` columns (§4.1, §4.2, §4.3) with `DEFAULT 'default'` so existing rows backfill without write hold.
2. Backfill `org_id` from `projects.org_id` join.
3. Drop `DEFAULT`; drop `project_id` columns.
4. Rebuild unique constraints and indexes (§4.1, §4.2, §4.3).
5. Create `project_agent_bindings` (§4.4).
6. Run binding backfill (§4.5): dedupe by `(org_id, name, content_hash)`, materialise bindings, drop absorbed rows.
7. Bump duplex envelope schema constant in shared TS / Rust types to `v: 2` for catalog, `v: 1` for bindings.
8. Re-emit `agent.catalog.snapshot` to all connected OPCs (forces cache rebuild on the desktop side).

### 9.3 Invariants

- I-1. At any point in time during migration, exactly one of `(project_id, org_id)` is populated on `agent_catalog`, `agent_catalog_audit`, `agent_policies`; never both, never neither.
- I-2. Post-cutover, no `agent_catalog` row exists without a corresponding `project_agent_bindings` row in at least one project (unless explicitly authored as a new draft after the migration). The migration log records any orphan and either binds it to the project that authored it or marks it `status: 'retired'`.
- I-3. Post-cutover, no code path references `agent_catalog.project_id`, `agent_catalog_audit.project_id`, or `agent_policies.project_id` outside (a) this migration, (b) historical migration files (27, 28), (c) the changelog. The grep gate is part of acceptance (A-5).

### 9.4 Spec 119 amendment edits

Apply in the same PR as this migration:

- `specs/119-project-as-unit-of-governance/spec.md` frontmatter: add `amended: "2026-05-01"`, `amendment_record: "123"`.
- `specs/119-project-as-unit-of-governance/spec.md` body: add an "Amended by spec 123 (2026-05-01)" callout near the top of §1.
- §4.3 of 119: edit the `agent_policies` row to read *"reverted to `org_id` by spec 123"*.
- §4 of 119: add a parenthetical noting `agent_catalog` and `agent_catalog_audit` are reverted to `org_id` by spec 123.

No other 119 edits.

## 10. Out of Scope

- **Multi-org agent sharing.** Agents are org-private. A "marketplace" of agents across orgs is explicitly deferred; if it becomes a real need, a future spec introduces it as a separate read-only mirror, not by widening the catalog scope.
- **Per-project agent forks with diff overrides.** Considered and rejected — see §2.1. Fork-as-new-org-agent is the supported path.
- **Re-introducing a `workspace` or `team` layer between organization and project.** 119 §8 already deferred this and stands.
- **Renaming the `Agents` top-nav label.** Sticking with "Agents" for parity with the existing project-level tab; any UX naming review is deferred.
- **Granular RBAC on bindings.** v1 of bindings uses project-membership for read/write. Granular per-agent binding permissions deferred to a follow-up if needed.
- **Migrating `.claude/agents/*.md` files into the org catalog.** Local file-source agents continue to work as project-local invocations; an explicit "promote to org catalog" affordance is a UX deferral, not a blocker.

## 11. Acceptance Criteria

A-1. Spec 119 carries `amended: "2026-05-01"`, `amendment_record: "123"`, and the callout at the top of §1 pointing to this spec.

A-2. Migration `30_agent_catalog_org_rescope.up.sql` applies cleanly against a representative dev database; invariants I-1..I-3 of §9.3 hold; the migration log records dedup statistics matching the pre-flight inventory.

A-3. `agent_catalog`, `agent_catalog_audit`, and `agent_policies` carry `org_id` (not `project_id`). `project_agent_bindings` exists with the schema in §4.4 and the four invariants I-B1..I-B4.

A-4. Statecraft web shows `Agents` as a top-nav item between `Projects` and `Factory`. The org agent catalog UI implements list / create / edit / publish / retire / fork / history.

A-5. `grep -rn "agent_catalog\.project_id\|agent_catalog_audit\.project_id\|agent_policies\.project_id\|agentCatalog\.projectId" platform/services/statecraft crates product/apps/opc` returns zero hits outside (a) historical migration files, (b) the migration script for this spec, (c) frozen superseded specs, (d) this spec's body.

A-6. The project `Agents` tab implements bind / repin / unbind against the org catalog. The 119-era authoring routes under `app.project.$projectId.agents.new` and `agents.$agentId.publish` are deleted.

A-7. Duplex envelope schema constant is bumped to `v: 2` for catalog envelopes and `v: 1` for binding envelopes. Desktop and platform agree at compile time (per the embedded-schema-version convention).

A-8. The Factory `agent_resolver` resolves stage agent references against the org catalog, and a Stage CD comparator run against two distinct projects uses identical agent definitions by `content_hash` (verified by an integration test).

A-9. The compiled spec registry (`.derived/spec-registry/registry.json`) carries `amends: ["119"]` on this spec and `amendment_record: "123"` on spec 119, with no schema-validation errors.

A-10. The codebase index (`.derived/codebase-index/index.json`) re-renders cleanly; spec 111 and spec 119 traceability continue to resolve to active code.

A-11. `make ci` passes on the post-migration branch.

## 12. Open Questions

OQ-1. **Backfill of agents authored under 119.** §4.5 dedupes by `(org_id, name, content_hash)`. If two projects in the same org authored agents with the same `name` but divergent content, the migration must choose: keep the highest version, keep both as `name` and `name-2`, or fail and require manual reconciliation. Defer to dev-DB inventory at migration time; fail-loud is the default if any divergence is detected.

OQ-2. **Bind-by-name vs bind-by-id.** §5.2 binds by `org_agent_id`. An alternative is bind-by-name with implicit version pinning. Bind-by-id is more explicit and matches Factory's pattern (pin a contract version); revisit if the UI ergonomics suffer.

OQ-3. **Default binding behaviour on project creation.** When a project is created, should it auto-bind to a default set of org agents? Default for now: no auto-bind, projects start with zero bindings and operators bind explicitly. Revisit if the empty-project case becomes friction.

OQ-4. **Fork-from-binding affordance.** When an operator wants project-specific behaviour, they currently navigate from the project binding view to the org catalog and fork there. A "fork into org catalog" shortcut from the project binding row could shorten the path. Deferred to UX iteration after v1.

OQ-5. **Audit composition with bindings.** Spec 098 (governance-enforcement-stitching) composes audit trails across primitives. Confirm that an `agent_catalog_audit` row + a `project_agent_bindings` change row + a Factory run row compose cleanly to answer "what agent definition ran in this Factory run for this project at this time." This is mostly a 098 verification, but worth flagging.

## 13. References

- spec 042 (`multi-provider-agent-registry`) — provider abstraction.
- spec 054 (`agent-frontmatter-schema`) — UnifiedFrontmatter contract.
- spec 087 §5.3 — duplex sync substrate.
- spec 098 (`governance-enforcement-stitching`) — audit trail composition.
- spec 108 (`factory-as-platform-feature`) — org-level Factory baseline.
- spec 111 (`org-agent-catalog-sync`) — original org-level design; this spec restores its scoping decision.
- spec 119 (`project-as-unit-of-governance`) — the spec amended here.
- spec 122 (`stakeholder-doc-inversion`) — Stage CD comparator, primary cross-project Factory consumer of agents.
- platform/services/statecraft/api/agents/catalog.ts — current project-scoped implementation under amendment.
- platform/services/statecraft/api/db/migrations/27_collapse_workspace_into_project.up.sql — the migration this spec partially reverses (agents only).
