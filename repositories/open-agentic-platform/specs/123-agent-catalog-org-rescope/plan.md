# Implementation Plan: Agent Catalog Org-Rescope

**Spec**: [spec.md](./spec.md)
**Feature**: `123-agent-catalog-org-rescope`
**Date**: 2026-05-01
**Branch**: `123-agent-catalog-org-rescope`

## Summary

Move `agent_catalog`, `agent_catalog_audit`, and `agent_policies` from `project_id` (set by spec 119 migration `27_collapse_workspace_into_project`) back to `org_id`. Add a `project_agent_bindings` join table that pins one org agent at one immutable version per project — no per-binding override of the agent definition. Surface the catalog as a top-nav `Agents` page in statecraft (sibling of `Projects` and `Factory`); rewrite the project `Agents` tab as a binding manager. Bump the duplex envelope schema (spec 087 §5.3 / spec 111 §7) to `v: 2` for catalog envelopes and add `v: 1` project-binding envelopes. Wire Factory's `agent_resolver` to the org catalog so cross-project Stage CD comparator runs (spec 122) reference identical agent definitions by `content_hash`. Amend spec 119 in place using its own `amends:` / `amendment_record:` convention; the rest of 119's workspace→project collapse is untouched.

## Sequencing

| Phase | Focus | Spec sections |
|-------|-------|---------------|
| **0** | Foundations: shared TS / Rust types for the new envelope versions; frontmatter constants; audit-action additions; codebase-index re-spin | §4, §7 |
| **1** | Schema migration `30_agent_catalog_org_rescope.up.sql` — `org_id` columns added + backfilled, `project_id` columns dropped, constraints rebuilt, `project_agent_bindings` created, dedup-and-bind backfill runs | §4, §9 |
| **2** | Statecraft API rewrite: `api/agents/catalog.ts` for org scope; new `api/agents/bindings.ts` module; old project-scoped CRUD endpoints removed | §5 |
| **3** | Duplex envelopes: bump catalog `v: 1 → v: 2`; introduce `project.agent_binding.updated` and `project.agent_binding.snapshot` at `v: 1`; relay routing; compile-time schema-version constant updated | §7 |
| **4** | Statecraft web — org `Agents` top-nav surface (`app.agents.*` routes); top-nav entry; old workspace-era authoring routes deleted | §6.1 |
| **5** | Statecraft web — project `Agents` tab rewrite as binding manager (bind / repin / unbind); 119-era `agents.new` and `agents.$agentId.publish` routes deleted | §6.2 |
| **6** | OPC desktop — `agent_catalog_sync.rs` schema bump for `org_id`; binding-aware `list_active_agents(project_id)`; `list_org_agents(org_id)` for ad-hoc browse | §6.3, §8.3 |
| **7** | Factory engine — `crates/factory-engine/src/agent_resolver.rs`; thread the resolver through Stage CD comparator (spec 122); integration test that two projects' Stage CD runs reference the same `content_hash` | §8.2, §11 A-8 |
| **8** | Spec 119 amendment edits land; spec 123 frontmatter flips to `status: approved` / `implementation: complete`; codebase index + spec registry recompile clean; acceptance gates A-1..A-11 verified | §3, §11 |

Phase 0 unblocks 1 and 3 in parallel-by-file (types are shared). Phases 4 and 5 can run in parallel once Phase 2's API surface is stable. Phase 6 depends on Phase 3 (envelope schema) but is independent of Phases 4/5. Phase 7 depends on Phase 2 (org catalog read endpoint) but not on Phases 4–6. Phase 8 is the closure phase — only after every prior phase's acceptance hooks are green.

## Approach decisions

- **Single migration, not phased.** Pre-alpha posture (no users) means the workspace→project→org churn is run all at once. A phased migration would carry two scope schemas in production simultaneously — cost without benefit. Migration `30` adds `org_id`, backfills, drops `project_id`, dedupes definitions, and materialises bindings in one transaction.
- **Dedup by `(org_id, name, content_hash)`, fail-loud on divergence.** Two projects in the same org may have authored agents with the same `name` but divergent body / frontmatter under the 119 regime. The migration will fail if any divergence is detected (OQ-1 in spec); the operator inspects, reconciles by hand (rename one, or accept one as canonical), and re-runs. Silently "winning" one definition would corrupt the audit chain.
- **Bind by `org_agent_id`, not by `name`.** Names are mutable across forks. Pinning an immutable id at an immutable version + content_hash gives Factory a stable reference (mirrors the contract-versioning pattern). Resolution from name happens once at bind time.
- **No per-binding override.** Section §2.1 of the spec is non-negotiable. The binding row carries `pinned_version` + `pinned_content_hash` only. Any project-specific behaviour requires a fork into a new org agent.
- **`ON DELETE RESTRICT` on the binding's `org_agent_id` FK.** Hard-deleting an org agent that has bindings would orphan project state. Retire is the supported path; retired agents keep bindings visible read-only.
- **Duplex envelope schema bump is a clean break.** No `v: 1` compat path. Compile-time schema-version constants in shared TS/Rust types make a desktop/platform mismatch a build error (per the schema-version-compile-time feedback memory), not a runtime parse failure.
- **Top-nav order: `Projects, Agents, Factory`.** Agents sit conceptually between projects (which import) and Factory (which runs). Putting `Agents` between matches the import-execute flow direction and keeps Factory's "execution" association closest to the right edge.
- **Factory `agent_resolver` is a new module, not a bolt-on.** Resolution today is implicit per-run — adding the org catalog without a resolver would scatter org-id lookups through every stage. A single module concentrates the seam, makes it testable, and lets Stage CD comparator (spec 122) assert by `content_hash`.
- **`.claude/agents/*.md` semantics unchanged.** Local file-source agents stay project-local invocations (spec 111 §2.4 `source: "file"`). Promotion to org catalog is not part of this spec; the path stays file-local until a future UX spec adds the promote affordance.
- **No `workspace_id` resurrection.** Spec 119's invariant I-3 (no `workspace` symbol post-cutover) stands. Code uses `org_id` directly.

## Risks

- **Cross-project name collision under dedup.** Two projects in one org with same agent name + divergent content forces a manual reconcile. Mitigation: pre-flight inventory script (§9.1) reports collisions before migration runs; the migration aborts (not silent-wins) on divergence; operator reconciles by renaming one in dev DB before re-running.
- **Desktop cache drift after envelope schema bump.** Older OPCs that connect post-migration receive `v: 2` envelopes they cannot parse. Mitigation: clean break per pre-alpha posture; compile-time schema-version constant ensures desktop/platform agree at build time. A shipped older desktop that connects displays a "statecraft requires desktop update" toast (no silent corruption).
- **Factory pipelines that today pin "agent name X" break post-migration.** With names now unique per `(org_id, name)` rather than per `(project_id, name)`, a name that was overloaded across projects becomes ambiguous. Mitigation: the resolver's first job is to fail loud on ambiguous name resolution; the `agent_resolver` integration test in Phase 7 covers this.
- **Spec 119 amendment edits + frontmatter changes drift the codebase-index.** The codebase-indexer scans `[package.metadata.oap]` and spec frontmatter to build traceability. Mitigation: re-run `codebase-indexer compile` as part of Phase 8 acceptance; A-10 verifies clean re-render.
- **Project_agent_bindings storm on first connect.** A fresh OPC connecting after migration receives the catalog snapshot + N project-binding snapshots. Mitigation: snapshot envelopes carry only `(binding_id, org_agent_id, pinned_version, pinned_content_hash)` — no body/frontmatter — so payload is tiny; full bodies fetched lazily via existing `agent.catalog.fetch_request` (spec 111 §2.3).
- **RBAC role addition (`org:agents:publish`) leaks into UI before Phase 4.** New role exists in API from Phase 2; UI surfaces it in Phase 4. Mitigation: Phase 2 API enforces `org:admin` as the floor (existing role) so the new role is purely additive; the gap window is a strictly-stricter policy.
- **`api/projects/:projectId/agents` route repurpose breaks any in-flight clients.** The route shape changes from "agent CRUD" to "binding list". Mitigation: pre-alpha posture (no external clients); the desktop client gets updated in the same PR sequence; any test fixture exercising the old shape gets rewritten.
- **Audit-row composition across `agent_catalog_audit` + `project_agent_bindings` change rows.** Spec 098 (governance-enforcement-stitching) composes audits across primitives. Mitigation: OQ-5 flags this for verification; Phase 8 acceptance confirms a Factory run + agent change + binding change can be reconstructed end-to-end.
- **`project_agent_bindings` retires-orphan visibility regression.** A retired agent leaves stale bindings; if the UI hides them entirely, operators lose the audit trail. Mitigation: I-B3 in spec keeps retired-upstream bindings visible with a `status: retired_upstream` indicator; Phase 5 UI must surface this distinctly (not just filter out).

## References

- Spec: [`./spec.md`](./spec.md)
- Tasks: [`./tasks.md`](./tasks.md)
- Pattern reuse:
  - Spec 111 (`org-agent-catalog-sync`) — original org-level design and duplex envelope shape; this spec restores its scoping
  - Spec 119 (`project-as-unit-of-governance`) — the spec amended; uses its own `amends:` / `amendment_record:` frontmatter convention
- Existing primitives this spec touches:
  - `platform/services/statecraft/api/agents/catalog.ts` — current project-scoped impl, rewritten
  - `platform/services/statecraft/api/agents/relay.ts` — duplex relay updated for v2 catalog + v1 binding envelopes
  - `platform/services/statecraft/api/sync/duplex.ts` — envelope kind registry
  - `platform/services/statecraft/api/db/migrations/27_collapse_workspace_into_project.up.sql` — what migration 30 partially reverses (agents only)
  - `platform/services/statecraft/web/app/routes/app.tsx` — top-nav adds `Agents`
  - `product/apps/opc/src-tauri/src/commands/agent_catalog_sync.rs` — schema bump
  - `crates/factory-engine/src/stages/stage_cd_comparator.rs` — passes through new resolver
- Cross-crate dependencies:
  - `crates/agent-frontmatter` — UnifiedFrontmatter contract; unchanged shape
  - `crates/factory-contracts` — pipeline contracts that reference agents; resolver feeds them by id+version
  - `crates/policy-kernel` — `agent_policies` rescoped to org; resolver in policy-kernel consumes the new shape
- Related specs: 042 (provider registry), 054 (frontmatter schema), 068 (permission runtime), 075 (factory workflow engine), 087 §5.3 (duplex sync), 090 (governance non-optionality), 098 (audit composition), 108 (factory as platform feature), 111 (origin), 119 (amended), 122 (Stage CD comparator)
