# Sync Protocol — Self-Reflection & Alignment Report

**Scope:** Outbox/inbox sync substrate in `platform/services/statecraft/api/sync/`.
**Spec binding:** [087 §5.3 Duplex Sync Substrate](../../../../../specs/087-unified-workspace-architecture/spec.md#53-duplex-sync-substrate) — FR-SYNC-001..010, amended by spec 119 (the project-as-unit-of-governance collapse).
**Date:** 2026-04-20 (initial) · 2026-04-29 (spec 119 amendment)
**Verdict:** **Structurally aligned, operationally incomplete — with one authorization defect remaining as a blocker.**

This document measures the implementation against the architectural intent of
spec 087 §5.3, post-spec-119 amendment. It is written to be honest about what
is *real* in the codebase versus what is *stubbed, best-effort, or deferred*.

## Spec 119 amendment (2026-04-29)

After the workspace-into-project collapse landed:

- **Wire envelope renamed.** `ServerMeta` now carries `orgId` and `orgCursor` (the prior workspace-keyed pair was retired). Schema version bumped 1 → 2 in `ENVELOPE_SCHEMA_VERSION`. The session is keyed by `orgId`; one OPC connection observes every project in its org.
- **Per-event projectId.** Every variant that needs project scope carries `projectId` on the envelope (e.g. `factory.event`); desktops filter client-side. Spec 123: the agent catalog envelopes (`agent.catalog.*`) now carry `orgId` directly since agents are org-scoped, and the new `project.agent_binding.*` variants carry `projectId` for project-bound state.
- **Variants dropped.** The legacy server-side workspace-updated variant (`workspace.updated`) was removed. The legacy workspace-keyed fields on `ServerProjectCatalogUpsert` and `ClientAgentCatalogFetchRequest` were removed (project lives directly under org; the agent-fetch request is verified server-side by comparing the catalog row's `org_id` against the session's `orgId` — spec 123 swapped this from a `agent_catalog → projects` join to a direct read).
- **Nack reason renamed.** `"workspace_mismatch"` → `"org_mismatch"`.
- **Agent catalog snapshot widened.** `buildAgentCatalogSnapshotEntries(orgId)` joins `agent_catalog` × `projects` and returns every published agent across the org; entries carry `projectId` so the desktop can attribute and filter.

## Post-review amendment (2026-04-20, retained)

After the first pass of this document, the following changes landed in the same branch:

- **Schema versioning shipped.** `EnvelopeMeta.v` is required on every envelope; the runtime guard rejects mismatched or missing `v`. See FR-SYNC-003.
- **Reflection bound to a spec.** Spec 087 extended with §5.3 "Duplex Sync Substrate" codifying FR-SYNC-001..010, the authority invariant, the membership-gate design, and the retention calculus.
- **Membership gate (FR-SYNC-002) re-classified.** Originally listed alongside scale/ops items; elevated here and in §5.3 to **correctness blocker**.

---

## What exists after this change

### Files

| File | Purpose |
|---|---|
| `types.ts` | Discriminated unions for `ClientEnvelope`, `ServerEnvelope`, handshake, meta. `isClientEnvelope` type guard. Org-scoped envelope. |
| `registry.ts` | In-memory `orgId → clientId → Session` registry with `sendTo`, `broadcastOrg`, auto-pruning of failed streams. |
| `store.ts` | `InboxStore` / `OutboxStore` / `CursorIssuer` interfaces with in-memory implementations, keyed by `orgId`. |
| `service.ts` | `handleInbound`, `publishAck`, `publishNack`, `dispatchServerEvent(orgId, ...)`. Only module that mints cursors. |
| `duplex.ts` | Authenticated `api.streamInOut` endpoint at `/api/sync/duplex` with handshake, `sync.hello`, heartbeat, cursor-gap detection. |
| `relay.ts` | PubSub subscriber that maps `FactoryEventTopic` events onto `dispatchServerEvent`, with `projectId → orgId` cache. |
| `projectCatalog.ts` / `projectCatalogRelay.ts` | `project.catalog.upsert` envelope builder + relay; snapshots span every project in the session's org. |
| `sync.ts` | Legacy `streamOut` + HTTP ingest path retained for the web UI; org-keyed. |
| `types.test.ts`, `registry.test.ts`, `store.test.ts`, `relay.test.ts`, `projectCatalog.test.ts` | Unit coverage. |

---

## A. Authority alignment

| Concern | Status |
|---|---|
| Statecraft remains the audit authority | **Yes.** `audit.candidate` from the desktop is **never** written verbatim — `service.ts` normalises the action (`opc.*` prefix), stamps `actor_user_id` from the authenticated JWT, and injects server-side metadata (`clientId`, `orgId`, `clientEventId`). The desktop cannot forge `actor_user_id`. |
| Statecraft remains authoritative for policy, grants, deploy state, project state | **Yes.** These are *outbound-only* envelope variants (`policy.updated`, `grant.updated`, `deploy.status`, `project.updated`). There is no inbound client variant that would let the desktop mutate them through this channel. |
| Desktop/OPC authority for local execution/checkpoints/artifacts/runtime | **Yes.** Inbound-only variants (`execution.status`, `checkpoint.created`, `artifact.emitted`, `runtime.observed`, `agent.invocation`). The server records them, but does not treat them as control-plane truth. |
| Authority split is explicit in the type system | **Yes.** `ClientEnvelope` and `ServerEnvelope` are disjoint unions. |

**Verdict: Fully aligned.**

---

## B. Sync model alignment

| Concern | Status |
|---|---|
| Application-layer sync, not DB replication | **Yes.** No replication of Postgres to Hiqlite. The transport is a typed event stream; each side persists whatever it is authoritative for. |
| Event directions and boundaries explicit | **Yes.** Disjoint envelope unions. |
| No "generic sync everything" pipe | **Yes.** Extending the union requires adding a named variant, not a free-form field. |

**Verdict: Fully aligned.**

---

## C. Auth alignment

| Concern | Status |
|---|---|
| Stream authenticated | **Yes.** `api.streamInOut` opened with `auth: true`. The global Encore gateway runs the Rauthy JWT validator before the handler executes. |
| Org from token, not handshake | **Yes.** `duplex.ts` reads `orgId` from `getAuthData()`, NEVER from the handshake. |
| Disabled-user enforcement | **Yes**, transitively — the Rauthy auth handler already rejects disabled users (FR-025). |

**Gaps:**
- WebSocket `auth: true` relies on Encore routing the upgrade request through the gateway authHandler. If that is bypassed in a particular deployment (e.g., direct pod access), the stream would be open. Mitigated by Helm/ingress policy, not by this file.
- **CORRECTNESS BLOCKER — FR-SYNC-002.** The authenticated user's membership in the org is NOT verified: any JWT with `oap_org_id = X` opens a stream in org X. If the claim drifts from the live membership tables (stale JWT after off-boarding, mis-issued token, claim tampering that passes signature check), the stream would grant org visibility the user no longer has. Fix lands before any non-test use.

**Verdict: Fully aligned for identity; **one authorization defect remains** (FR-SYNC-002, blocker).**

---

## D. Persistence alignment

| Concern | Status |
|---|---|
| Durable outbox | **No.** `OutboxStore` is an in-memory ring buffer capped at 500 events per org. Statecraft restart wipes it. |
| Durable inbox | **No.** `InboxStore` is a 1,000-entry ring buffer. |
| Audit events for `audit.candidate` | **Yes, durable.** Persisted via Drizzle into the real `audit_log` table. |
| Persistent cursor | **No.** Cursors live in an in-memory `Map<string, bigint>`, reset on restart. |

**Retention calculus of the in-memory outbox (`MAX_OUTBOX_PER_ORG = 500`):**
- At target event rate **~10 events/s** (factory progress + audit + periodic deploy/grant changes) → **~50 seconds** of history retained.
- At burst rate **~50 events/s** (factory stage fan-out) → **~10 seconds** of history retained.
- A reconnect gap exceeding the retained window forces `sync.resync_required(cursor_gap)` and a REST-backed refetch.

**What's required to move forward (FR-SYNC-005 — spec 087 §5.3, amended 119):**
- A `sync_outbox` Postgres table with `(org_id, cursor, event_id, payload, created_at)`, one row per server event.
- A `sync_outbox_delivery` table with `(org_id, event_id, client_id, acked_at)` to persist ACKs and drive redelivery on reconnect.
- Replace `InMemoryOutbox`, `InMemoryInbox`, `MonotonicCursorIssuer` with Drizzle-backed implementations.

**Verdict: Structurally aligned, operationally incomplete.**

---

## E. Delivery semantics honesty

| Property | Real? |
|---|---|
| At-most-once in-process, best-effort across reconnects | ✅ |
| Per-inbound-event server ACK/NACK | ✅ |
| Monotonic cursor per org within a single statecraft process lifetime | ✅ |
| Cursor-gap detection at reconnect via `SyncHandshake.lastServerCursor` → `sync.resync_required` | ✅ |
| Replay of unacked server events on reconnect when cursor is known | ✅ (via `deliverResync` + outbox), **bounded by ring buffer** |
| At-least-once delivery across statecraft restarts | ❌ (outbox wiped on restart) |
| Exactly-once delivery | ❌ — never claimed. |
| Backpressure / flow control | ❌ — `stream.send` is awaited but there is no explicit window/credit. |
| Ordering across orgs | ❌ — per-org ordering only. |
| Cross-replica fan-out when statecraft scales horizontally | ❌ — each replica's registry is local. |

**Verdict: Honest. Claims match implementation.**

---

## F. Org isolation

| Concern | Status |
|---|---|
| Registry keyed by orgId | **Yes.** `broadcastOrg` cannot leak across orgs — verified by `registry.test.ts`. |
| Org taken from authenticated claims, not client input | **Yes.** See section C. |
| Outbox cursor scoped per-org | **Yes.** Verified by `store.test.ts`. |
| `ClientAuditCandidate` forcibly stamped with server-side `orgId` | **Yes.** |
| `agent.catalog.fetch_request` cross-org probe rejected | **Yes.** Server reads `agent_catalog.org_id` directly (spec 123) and compares against the session's `orgId`; mismatch surfaces as `org_mismatch`. |

**Verdict: Fully aligned.**

---

## G. Runtime readiness

**Is this sufficient for production?** **No.** Gaps ordered by severity, with spec 087 §5.3 FR-IDs:

| # | Gap | Class | FR | Status |
|---|-----|-------|----|--------|
| 1 | **Membership gate** — the stream should verify the authenticated user is an active member of `orgId` (join on `org_memberships`), not just that the JWT declares it. | **correctness — blocker** | FR-SYNC-002 | not shipped |
| 2 | Durable Postgres outbox/inbox (see §D). | durability | FR-SYNC-005 | not shipped |
| 3 | Cross-replica fan-out — events on replica A must reach clients on replica B via PubSub. | correctness (multi-replica) | FR-SYNC-006 | not shipped |
| 4 | Backpressure / slow-client handling — `await stream.send` is sequential per client. | liveness | FR-SYNC-007 | not shipped |
| 5 | Observability — `sync_connections_total`, `sync_events_inbound_total`, `sync_events_outbound_total`, `sync_ack_latency_seconds`. | ops | FR-SYNC-008 | not shipped |
| 6 | Rate limiting per `clientId`. | abuse resistance | FR-SYNC-009 | not shipped |
| 7 | ~~Envelope schema versioning~~. | correctness | FR-SYNC-003 | **shipped** — `EnvelopeMeta.v` required; runtime guard rejects mismatch. |

**What IS production-safe:**
- Type guards reject unknown inbound kinds (no arbitrary-code-execution surface from client-supplied `kind`).
- Envelope schema version is required and strictly equal to the current `ENVELOPE_SCHEMA_VERSION`; future v3 clients cannot silently fall through a best-effort decoder.
- `audit.candidate` is normalised, not trusted.
- Registry auto-prunes dead streams on send failure.
- All logging avoids emitting the raw payload.

**Verdict: Misaligned for production use as-is. Aligned as a foundation for subsequent phases; one item (FR-SYNC-002) must land before any non-test deployment.**

---

## H. Invariants (codified in spec 087 §5.3, amended by spec 119)

These are the rules future contributors MUST honour when touching this directory. Violating any of them is a spec violation, not a code-review preference.

1. **Authority is encoded in the envelope union.** `ClientEnvelope` variants MUST NOT carry control-plane authority (policy/grant/deploy/project state mutation). `ServerEnvelope` carries control-plane truth. Extending `ClientEnvelope` with a variant that asserts authoritative server state is a governance act requiring a spec amendment.
2. **`orgId` is taken from the authenticated JWT, never from the handshake.** Any code path that reads an org id from client-supplied data in `/api/sync/duplex` is a bug.
3. **`audit.candidate` is normalised, not trusted.** `actor_user_id` MUST be stamped from `auth.userID`; the `action` is prefixed `opc.`; `clientId` and `orgId` are server-stamped in `metadata`. Timestamps come from the server, not the desktop.
4. **Cursors are minted only in `service.ts#mintMeta`.** No other module mints an `orgCursor`. This is the single place that orders the outbound stream.
5. **`EnvelopeMeta.v` MUST equal the current `ENVELOPE_SCHEMA_VERSION`.** Bumping the version is a lock-step change to the TypeScript literal *and* the runtime guard in `isClientEnvelope`.
6. **The store interfaces are the swap boundary.** `OutboxStore`, `InboxStore`, and `CursorIssuer` exist so Drizzle-backed implementations can replace the in-memory ones without touching `duplex.ts` or `service.ts`. Do not leak storage concerns past those interfaces.
7. **Project scope rides on the event, not the session.** Per-event `projectId` is how the desktop filters; the session itself is org-keyed. Re-introducing a session-level `projectId` would re-create the very abstraction spec 119 collapsed.

---

## Honest summary

> **Structurally aligned, operationally incomplete.**

The shape is right:
- authority boundaries are encoded in the type system,
- auth is real,
- org isolation is real,
- the interface seams for a durable store exist and are exercised by tests,
- the reflection document matches the code.

What is **not** production-grade and must land before any customer traffic:
- durable Postgres-backed outbox/inbox,
- cross-replica fan-out,
- org membership check (not just JWT claim check),
- backpressure + rate limiting,
- metrics.

## Concrete follow-ups (ordered by severity)

1. **[FR-SYNC-002 — blocker]** Org-membership check inside `duplex.ts` before calling `registry.register`. Must land before any non-test deployment.
2. **[FR-SYNC-005]** Durable Postgres outbox/inbox tables + Drizzle-backed implementations of the `store.ts` interfaces.
3. **[FR-SYNC-006]** PubSub fan-out adapter so `dispatchServerEvent` reaches every replica's registry.
4. **[FR-SYNC-007]** Backpressure + slow-client handling in the broadcast loop.
5. **[FR-SYNC-008]** Prometheus metrics: `sync_connections_total`, `sync_events_inbound_total{kind, status}`, `sync_events_outbound_total{kind}`, `sync_ack_latency_seconds`.
6. **[FR-SYNC-009]** Rate limiting per `clientId`.
7. **[FR-SYNC-010]** Decommission the legacy `orgEventStream` streamOut + `ingestOpcEvent` HTTP endpoint. Blocked on migration of the remaining web UI consumer in `platform/services/statecraft/web/`. The OPC desktop consumes the typed duplex; the web UI is the last legacy caller.
