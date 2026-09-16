# Spec 123 — Implementation Audit

> Audit performed on 2026-05-05 against the current state of the working tree.
>
> **§4 / §5 superseded by [spec 139](../139-factory-artifact-substrate/spec.md)
> (Phase 4b, 2026-05-05).** The `project_agent_bindings` table —
> spec 123's project-binding mechanism — was retired by migration 35
> (`35_drop_legacy_agent_catalog_family`). Universal `factory_bindings`
> (spec 139 §2.1) replaces it: same row shape (`pinned_version`,
> `pinned_content_hash`), applied to any artifact kind. Spec 123
> invariants I-B1..I-B4 carry over verbatim:
>
>   * **I-B1** — no definition override (binding row carries
>     id+version+hash only).
>   * **I-B2** — pin integrity: `pinned_content_hash` MUST match the
>     substrate row's `contentHash` at `(artifactId, pinnedVersion)`.
>     Verified by `verifyBindingIntegrity()` in
>     `api/agents/bindings.ts` (spec 098 nightly probe, T036).
>   * **I-B3** — retired-upstream bindings stay readable
>     (`status='retired_upstream'`); bind/repin to a retired substrate
>     row is rejected with a typed "retired" error.
>   * **I-B4** — substrate rows retire in place (`status='retired'`)
>     instead of hard delete; bindings stay valid for audit.
>
> Spec 123's external API surface
> (`/api/projects/:projectId/agents[/...]`) is preserved; the storage
> primitive is replaced. See spec 139 §2.1 for the substrate row shape,
> §3.1 for the origin taxonomy (user-authored = spec 111/123 territory),
> and §10 for the symmetry table.

## Section coverage matrix

| Spec section | Status | Notes |
|--------------|--------|-------|
| §3 Org rescope | ✅ preserved | Agents remain org-scoped via `factory_artifact_substrate.org_id`. |
| §4 Catalog handlers | ✅ preserved | `api/agents/catalog.ts` reads+writes substrate-direct (Phase 4 narrow). |
| §5 Bindings (`project_agent_bindings`) | ✅ retired | `factory_bindings` is the authoritative store. `api/agents/bindings.ts` reads+writes substrate-direct (Phase 4b). |
| §6 UI semantics | ✅ preserved | One binding per agent name per project; retired-upstream surfaces as `status='retired_upstream'`. |
| §7 Duplex sync | ✅ preserved | `publishProjectAgentBindingUpdated` envelope unchanged; relay projects substrate row IDs. |
| §8 Desktop integration | ✅ preserved | OPC SQLite cache schema unchanged; duplex envelopes unchanged. |

## Migration trail (spec 139 cutover)

```
platform/services/statecraft/api/db/migrations/
  32_factory_artifact_substrate.up.sql        — creates substrate + bindings (Phase 1)
  33_migrate_agent_catalog.up.sql             — mirror project_agent_bindings → factory_bindings (Phase 2)
  34_drop_legacy_factory_tables.up.sql        — drops spec 108 trio (Phase 4 narrow)
  35_drop_legacy_agent_catalog_family.up.sql  — drops project_agent_bindings + agent_catalog family (Phase 4b)
```

The `audit_log.action` enum stays at `agent.binding_{created,repinned,unbound}`
post-cutover — spec 139 §6.4 reserves `factory.binding_*` for non-agent
binding kinds, and today's `bindings.ts` mutates only agent bindings.

The spec 098 integrity probe (`verifyBindingIntegrity` exported from
`api/agents/bindings.ts`) was re-pointed at the substrate join in B-1
of Phase 4b. The probe contract is unchanged: empty list → all bindings
clean; `hash_drift` and `row_missing` violations are surfaced for the
nightly job.
