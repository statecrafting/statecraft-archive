# Spec 111 — Implementation Audit

> Audit performed on 2026-05-05 against the current state of the working tree.
>
> **§Data model superseded by [spec 139](../139-factory-artifact-substrate/spec.md)
> (Phase 4b, 2026-05-05).** The `agent_catalog` and `agent_catalog_audit`
> tables — spec 111's authoritative org-scoped agent storage — were
> retired by migration 35 (`35_drop_legacy_agent_catalog_family`). The
> data lives in `factory_artifact_substrate` post Phase 2 mirror
> (migration 33) + Phase 4 substrate-direct read swap on
> `api/agents/catalog.ts` + Phase 4b substrate-direct read/write swap on
> `api/agents/bindings.ts`. Consumers project the spec 111 ternary
> (`draft|published|retired`) from `frontmatter.publication_status`
> (Phase 2 seeded this on every row; catalog/bindings handlers maintain
> it post-cutover). Spec 111's external API surface
> (`/api/orgs/:orgId/agents/*`) is preserved; the storage primitive is
> replaced. See spec 139 §2.1 for the substrate row shape and §10 for
> the symmetry table.
>
> The duplex sync wire shape (`agent.catalog.snapshot`,
> `agent.catalog.updated`, `agent.catalog.fetch_request`) is unchanged
> — the relay (`api/agents/relay.ts`) projects substrate rows into the
> spec 111 wire envelope shape using the same UUID identifiers
> (migration 33 preserved every legacy `agent_catalog.id` as the new
> `factory_artifact_substrate.id` so existing OPC consumers keep
> recognising the rows they know).

## Section coverage matrix

| Spec section | Status | Notes |
|--------------|--------|-------|
| §2 Data model | ✅ retired | Substrate (`factory_artifact_substrate`, `origin='user-authored'`) is the authoritative store. |
| §3 Encore APIs | ✅ preserved | All `/api/orgs/:orgId/agents/*` endpoints continue to serve. Read+write substrate-direct (`api/agents/catalog.ts`, `api/agents/bindings.ts`). |
| §4 Duplex sync | ✅ preserved | Outbound relay envelopes project from the substrate row (`api/agents/relay.ts`). Inbound `agent.catalog.fetch_request` reads substrate (`api/sync/service.ts:serveAgentCatalogFetch`). |
| §5 Frontmatter contract | ✅ preserved | `CatalogFrontmatter` remains the authored shape; `publication_status` is the spec 111 ternary, injected by catalog handlers and stripped from the wire frontmatter on read. |
| §6 OPC local merge | ✅ preserved | OPC desktop's local SQLite cache mirrors the duplex envelopes; cache schema unchanged. |

## Migration trail (spec 139 cutover)

```
platform/services/statecraft/api/db/migrations/
  32_factory_artifact_substrate.up.sql        — creates substrate + bindings (Phase 1)
  33_migrate_agent_catalog.up.sql             — mirror agent_catalog → substrate (Phase 2)
  34_drop_legacy_factory_tables.up.sql        — drops spec 108 trio (Phase 4 narrow)
  35_drop_legacy_agent_catalog_family.up.sql  — drops spec 111 + 123 family (Phase 4b)
```

After migration 35 ships, the spec 111 problem statement (no shared
agent catalog across desktops) is solved by the substrate, not by the
retired `agent_catalog` table. The spec's design intent stands; only
the storage primitive moved.
