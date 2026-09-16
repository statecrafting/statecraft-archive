---
id: "110-statecraft-to-opc-factory-trigger"
slug: statecraft-to-opc-factory-trigger
title: Statecraft-initiated Factory Run Trigger over the Duplex Channel
status: approved
implementation: complete
owner: bart
created: "2026-04-21"
kind: platform
domain: platform
summary: >
  Closes the "no statecraft → OPC trigger" gap surfaced during the 2026-04-21
  audit. Adds a `ServerEnvelope::factory.run.request` variant to the duplex
  sync channel (spec 087 §5.3), a paired `ClientEnvelope::factory.run.ack`
  for desktop acknowledgement, a tab-session model as the unit of execution
  dispatch on OPC, and a knowledge-bundle materialisation contract so the
  engine receives local file paths even when knowledge lives in the
  workspace object store. Makes "click Initialize in statecraft → run
  starts in OPC" a governed, type-safe flow.
depends_on:
  - "075-factory-workflow-engine"  # factory-workflow-engine (the engine that actually runs)
  - "076-factory-desktop-panel"  # factory-desktop-panel (the UX surface this wires into)
  - "077-statecraft-factory-api"  # statecraft-factory-api (the initPipeline endpoint)
  - "087-unified-workspace-architecture"  # unified-workspace-architecture (duplex channel + authority invariant)
  - "092-workspace-runtime-threading"  # workspace-runtime-threading (workspace_id on all execution)
  - "094-unified-artifact-store"  # unified-artifact-store (where artifact hashes land)
  - "108-factory-as-platform-feature"  # factory-as-platform-feature (where the button lives)
  - "109-factory-pat-and-pubsub-sync"  # factory-pat-and-pubsub-sync (PubSub pattern used here)
establishes:
  - unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/sync_client.rs }
extends:
  - spec: "087-unified-workspace-architecture"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/sync/types.ts }
  - spec: "087-unified-workspace-architecture"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/sync/relay.ts }
  - spec: "075-factory-workflow-engine"
    nature: additive
    unit: { kind: file, path: crates/factory-engine/src/bin/factory_run.rs }
  - spec: "109-factory-pat-and-pubsub-sync"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/factory/factory.ts }
  - spec: "085-remote-control-cli"
    nature: additive
    unit: { kind: file, path: product/packages/oap-ctl/src/cli.js }
---

# 110 — Statecraft-initiated Factory Run Trigger over the Duplex Channel

## 1. Problem

The Factory "Initialize Pipeline" surface in statecraft (spec 108, wired in
the 2026-04-21 fix for `workspaceId` plumbing) writes a pipeline row and
returns a `pipeline_id`. Nothing else happens. OPC — the only component
that can actually execute the 7-stage pipeline — has no way to know a run
was requested. The `StatecraftClient` on the desktop is **one-way
outbound**: it publishes execution progress, checkpoints, and audit
candidates to statecraft, but it never receives a "start a run" instruction.

As a result, today's shortest path to a Factory run is:

1. User clicks Initialize in statecraft → row inserted, UI shows "pending"
   forever.
2. User walks to their desktop, opens OPC, finds the project, clicks
   Initialize *again* locally.
3. OPC invokes `start_factory_pipeline` Tauri command which resolves
   `<repo>/factory/` locally and runs the engine.
4. OPC dual-writes progress back to statecraft, which finally updates the
   row created in step 1 (or creates a second one — no attribution glue
   exists today).

This is the exact architectural split we do **not** want: statecraft is
meant to be the orchestrator and OPC the executor (087 §3.1, 108 §7). The
boundary is inverted because the trigger only works in the OPC → statecraft
direction.

Compounding this:

- **Knowledge bundle shape mismatch.** `initPipeline` accepts
  `knowledge_object_ids` that resolve to object-store `storage_ref`s.
  `factory-run --business-docs` wants local filesystem paths. There is no
  bridge. A run requested with attached knowledge works from statecraft's
  perspective but cannot be honoured by the engine without the user
  manually downloading each object.
- **Session ambiguity.** Today OPC runs "one factory pipeline at a time"
  per the implicit global state in `product/apps/opc/src-tauri/src/commands/
  factory.rs`. There is no concept of which *tab* (which workspace, which
  session, which agent context) a run belongs to. If statecraft pushes N
  runs we have no type-safe way to route them.

## 2. Decision

Three additions, each narrow, each addressing one of the gaps above.

### 2.1 `ServerEnvelope::factory.run.request` variant (new control-plane)

Add to `platform/services/statecraft/api/sync/types.ts`:

```ts
/**
 * ServerEnvelope variant: statecraft asks a connected OPC to start a
 * locally-executed factory run.
 *
 * This is a control-plane instruction (server → client) and falls under
 * the 087 §5.3 authority invariant. Adding this variant is a governance
 * act; it asserts platform authority over a desktop resource.
 *
 * Semantics:
 *   - Exactly-once intent per pipeline_id. The outbox guarantees at-least
 *     -once delivery; the desktop MUST dedupe by pipeline_id.
 *   - The desktop replies with `ClientEnvelope::factory.run.ack` within
 *     30s, or statecraft marks the pipeline `abandoned` on the next
 *     heartbeat window.
 *   - Multiple OPC instances may be connected per workspace. The first to
 *     ack wins; others receive a `sync.nack` for the same event_id.
 */
interface FactoryRunRequest {
  v: 1;
  kind: "factory.run.request";
  event_id: string;               // outbox id
  workspace_id: string;
  project_id: string;
  pipeline_id: string;
  adapter: string;                // one of KNOWN_ADAPTERS
  actor_user_id: string;          // who clicked Initialize
  knowledge: KnowledgeBundle[];   // see §2.3
  business_docs: BusinessDocRef[];// explicit doc uploads, same shape as 108
  policy_bundle_id: string;       // already compiled server-side
  requested_at: string;           // ISO-8601
  deadline_at: string;            // ISO-8601, honoured by NACK
}
```

### 2.2 `ClientEnvelope::factory.run.ack` variant (new observation)

Adding a `ClientEnvelope` variant that *observes* a local intent to run
**is within scope** per 087 §5.3 extension rule — it reports a local
observation, not an assertion of server state.

```ts
interface FactoryRunAck {
  v: 1;
  kind: "factory.run.ack";
  pipeline_id: string;            // correlates to the request
  session_id: string;             // see §2.4
  opc_instance_id: string;        // stable per OPC launch
  accepted: boolean;              // false => opc saw the request but declined
  decline_reason?: string;        // when accepted === false
  observed_at: string;
}
```

Existing `ClientEnvelope::execution.status` and `checkpoint.created`
variants already carry execution progress; **no new progress variants are
required**. They SHOULD set `pipeline_id` in their payload so statecraft
can correlate them to the run it requested.

### 2.3 Knowledge bundle materialisation

The engine binary takes local file paths. The server side holds object-
store references. Bridge this at dispatch time:

```ts
type KnowledgeBundle = {
  object_id: string;
  filename: string;
  content_hash: string;            // sha-256, for local cache keying
  download_url: string;            // presigned, 15 min TTL, regenerated
                                   //  on resync if expired
};
```

On the desktop side, before `start_factory_pipeline` invokes `factory-run`:

1. For each `KnowledgeBundle`, check local content-addressable cache at
   `$OPC_CACHE_DIR/knowledge/<sha256>`. If present and hash matches, use it.
2. Otherwise GET `download_url`, verify the body's sha-256 equals
   `content_hash`, write to the cache, then use it.
3. Pass the resolved local paths as `--business-docs`.
4. On a hash mismatch: mark the pipeline `failed` in statecraft with
   `details.reason = "knowledge_hash_mismatch"` and halt. This is a trust
   boundary — an engine run must never consume a corrupted or substituted
   input silently.

Cache eviction is LRU with a workspace-scoped size cap (default 5 GiB).

### 2.4 Tab session as the execution unit

Formalise the concept already emerging in the OPC UI: each tab is an
independent execution context with its own short-lived session_id.

- `session_id: Uuid` is minted on tab creation and lives in the tab's
  React state + a matching Rust-side record.
- The `ProcessRegistry` (already `HashMap<i64, ProcessHandle>`) gains a
  `session_id` column so runs are lookup-able by session, not just by pid.
- `ClientEnvelope::factory.run.ack` reports the session_id that accepted
  the request. All subsequent `execution.status` frames carry the same id.
- Tab close triggers a drain: pending audit envelopes flush, the factory
  engine SIGINTs cleanly, and the run's final state is persisted before
  the tab's Rust-side state is dropped.

This spec does **not** require per-session axiomregent isolation. That is
deferred to spec 111 (and potentially a dedicated sidecar-multiplicity
spec). Multiple tabs may share one axiomregent sidecar today; the
`session_id` merely lets statecraft route correctly.

### 2.5 `oap-ctl run factory` subcommand

`product/packages/oap-ctl` gains:

```
oap-ctl run factory <project-id> \
    --adapter <name> \
    [--knowledge <object-id>…] \
    [--watch]
```

It calls the **same statecraft `initPipeline` endpoint** the web UI calls.
The CLI is a thin front door to the same orchestration path; the browser
button and CLI are interchangeable. `--watch` subscribes to the project's
pipeline events via a small SSE endpoint (`GET /api/projects/:id/factory/
stream`, to be added in this spec) and prints stage transitions until the
run reaches a terminal state.

This avoids introducing a second execution path. The executor is always
OPC; the trigger comes from statecraft regardless of whether the user
clicked a button or typed a command.

## 3. Contract Additions

Statecraft-side:

| Symbol | Path | New or changed |
|---|---|---|
| `FactoryRunRequest` | `api/sync/types.ts` | new `ServerEnvelope` variant |
| `FactoryRunAck` | `api/sync/types.ts` | new `ClientEnvelope` variant |
| `relay.publishFactoryRunRequest` | `api/sync/relay.ts` | new helper |
| `initPipeline` | `api/factory/factory.ts` | after inserting the row, call `relay.publishFactoryRunRequest` |
| `/api/projects/:id/factory/stream` | `api/factory/stream.ts` (new) | SSE endpoint for CLI `--watch` |
| `isClientEnvelope` | `api/sync/types.ts` | recognise `factory.run.ack` |

Desktop-side:

| Symbol | Path | New or changed |
|---|---|---|
| Inbound handler | `product/apps/opc/src-tauri/src/commands/statecraft_client.rs` | handle `factory.run.request`, dispatch to local factory command |
| `materialize_knowledge_bundle` | `product/apps/opc/src-tauri/src/commands/factory.rs` (new helper) | cache-aware download with sha-256 verification |
| `session_id` plumbing | `product/apps/opc/src-tauri/src/process/registry.rs`, `product/apps/opc/src/stores/agentStore.ts` | thread through Rust + frontend |
| Tab close drain | `product/apps/opc/src-tauri/src/lib.rs` (event handler) | SIGINT + audit flush on tab close |

Engine-side:

- No changes to `crates/factory-engine` for §2.1–2.4.
- `factory-run` CLI gains `--content-hash <sha256>` alongside each
  `--business-docs` entry so the desktop's materialisation step is
  verifiable at the engine boundary too. Optional today; mandatory for
  statecraft-triggered runs.

CLI-side:

- `product/packages/oap-ctl/src/cli.js` adds the `run factory` command. The
  existing `--opc-url` option is ignored for this subcommand because the
  request goes to statecraft, not to the local OPC control server.

## 4. Authority Invariant Check (087 §5.3)

Adding `ServerEnvelope::factory.run.request` asserts platform authority
over a local resource (the user's desktop). This is **governance by
design**:

- Request originates from an authenticated statecraft user.
- The request rides the workspace-scoped duplex stream — only connected
  OPC instances bound to that workspace's JWT receive it.
- The desktop enforces its own policy bundle (spec 047) before acting on
  the request. A user with a policy that forbids running Factory locally
  still rejects the request via `FactoryRunAck { accepted: false }`.
- This is a trigger, not a code execution — statecraft sends a directive,
  and the desktop decides how to fulfil it using its own engine, adapters,
  and policies.

Adding `ClientEnvelope::factory.run.ack` is a local observation: "I saw
the request". Within scope per the extension rule.

## 5. Non-goals

- **Multi-OPC fan-out.** Only one OPC handles a given run. If two OPCs are
  connected, the first to ack wins and the rest no-op. Load-balancing
  across desktops is a future concern.
- **Headless OPC.** This spec assumes a desktop-bound OPC. A CI-runnable
  headless variant is out of scope (and belongs with a revived spec 078
  or similar).
- **Statecraft-hosted inference.** Model keys stay on OPC machines —
  decided 2026-04-21 and noted in spec 111 §4. No LLM proxying here.
- **Per-session axiomregent isolation.** The session_id is a routing key,
  not a sidecar-spawn directive. Per-session sidecars are a future spec.

## 6. Open Questions

1. **Presigned URL TTL.** 15 min is the current instinct. Shorter is
   safer; longer is kinder to slow downloads of large knowledge objects.
   Lean short; rely on resync to regenerate.
2. **Desktop offline / OPC unavailable.** If no OPC is connected when
   Initialize is clicked, should statecraft hold the request for a
   deliverability window? Proposal: persist in `sync_outbox` (FR-SYNC-005
   once shipped) and wait up to 1 hour; otherwise mark the pipeline
   `abandoned`. Depends on outbox durability which is not yet shipped
   under 087 FR-SYNC-005.
3. **Knowledge hash mismatch vs. rotation.** If a knowledge object is
   re-uploaded with new content while a run is pending, should the run
   use the old hash or the new? Proposal: the request snapshots the hash
   at `initPipeline` time; re-uploads do not invalidate in-flight runs.

## 7. Verification

- Unit: `types.test.ts` extended with acceptance/rejection cases for the
  new variants.
- Integration: statecraft test spawns an in-process duplex client,
  issues `initPipeline`, asserts the request envelope is published, and
  that an `ack` correlates correctly.
- Desktop-side integration: a mock statecraft sends `factory.run.request`;
  the desktop honours the request with a fake adapter and round-trips
  `execution.status` back.
- CLI: `oap-ctl run factory --help` contract test; end-to-end test with a
  local statecraft instance.

## 8. Rollout

Revised 2026-04-21 after pre-implementation audit: the desktop has **no**
duplex-stream consumer today (confirmed by grep across
`product/apps/opc/src-tauri/`). Original §10 claim "StatecraftClient reads the
stream for bookkeeping" was wrong — the Rust-side `StatecraftClient` is
HTTP-only. Bootstrapping the desktop consumer is the gating dependency,
not a footnote.

1. **Type additions.** Land `ServerFactoryRunRequest` +
   `ClientFactoryRunAck` in `api/sync/types.ts` with widened wire
   interfaces, `CLIENT_KINDS`, and unit tests that also assert directives
   cannot slip through the client-inbox guard. Backwards compatible — new
   variants are discriminated by `kind`, old clients silently ignore. No
   runtime wiring yet.
2. **Desktop duplex consumer bootstrap.** New
   `product/apps/opc/src-tauri/src/commands/sync_client.rs` that opens the
   Encore `/api/sync/duplex` stream, performs the handshake, maintains
   heartbeat + resync, and exposes a typed envelope-dispatch table. With
   no registered handlers beyond heartbeat + logging, this is dead code
   from the user's perspective but paves the path for §3–§5 and for spec
   111. Sized as its own commit; covers what §10 originally hand-waved.
3. **Statecraft `relay.publishFactoryRunRequest`** and hook it into
   `initPipeline` *behind a feature flag* on the pipeline row (`source:
   "opc-direct" | "statecraft"`). OPC-direct runs skip the envelope path.
   Add a `source` column to `factory_pipelines` (migration — no existing
   column per spec 108 schema).
4. **Desktop-side handler.** Register the `factory.run.request` dispatch
   in the consumer from §2, implement knowledge-bundle materialisation
   (§2.3), plumb `session_id` through `FactoryRunContext` and the tab
   state (§2.4), and emit `factory.run.ack`. With the flag off, still
   dead code.
5. **`oap-ctl run factory`** and the SSE endpoint
   (`GET /api/projects/:id/factory/stream`).
6. **Flip the flag on by default.** `oap-ctl` and web both go through the
   envelope path. OPC-direct remains available for offline workflows. The
   TS-level default in `initPipeline` flips to `"statecraft"`; the desktop's
   `StatecraftClient::init_pipeline` dual-write pins `source: "opc-direct"`
   explicitly to preserve the legacy local-exec flow and avoid a self-
   dispatch loop back to the same OPC. The DB-column default stays
   `"opc-direct"` as the safe fallback for future code paths that insert
   without specifying source.

## 9. Dependencies already shipped

- 087 §5.3 duplex channel on the **server** side (`api/sync/` module).
  The desktop consumer is NOT yet shipped — see Rollout phase 2.
- 108 Factory tables + `initPipeline` (shipped).
- 109 PubSub pattern (shipped; we reuse the mental model, not the topic).
- Knowledge object storage + presigned URLs (shipped in 087 Phase 2).

## 10. Implementation notes

- `factory.event` already exists as a `ServerEnvelope` variant. **Do not**
  reuse it for run requests — it's an observation variant, not a
  directive. Keeping the two separate preserves the authority invariant.
- The desktop's `StatecraftClient` (`product/apps/opc/src-tauri/src/commands/
  statecraft_client.rs`) is **HTTP-only** — 847 lines of REST calls, no
  duplex reader. Rollout phase 2 introduces a sibling `sync_client.rs`
  that owns the streaming connection. Mixing the two into one module
  would confuse request/response semantics with long-lived-stream
  semantics; keep them distinct.
- The envelope-dispatch table on the desktop (phase 2) should be
  extensible enough that spec 111's `agent.catalog.updated` directive can
  register a handler with zero refactor — pattern is `HashMap<&'static
  str, Arc<dyn EnvelopeHandler>>` or equivalent.
- Unit tests in `api/sync/types.test.ts` MUST include a "forged
  directive" case: a client synthesising `factory.run.request` on the
  inbox must fail `isClientEnvelope`. This encodes the authority
  invariant at the guard layer, not only at the schema layer.
- *Amended 2026-06-01 (duplex auth lifecycle):* the `sync_client.rs`
  reconnect loop resolves its bearer JWT at connect time from the shared OS
  keychain (`StatecraftClient`) rather than from a launch-time snapshot, and
  on a 401 during the WebSocket upgrade it drives the same silent Rauthy
  refresh the REST path uses (`StatecraftClient::refresh_jwt`, now
  `pub(crate)`) before retrying. The consumer now spawns whenever a Statecraft
  base URL is configured — without requiring a token at launch — and idles on
  a short poll until sign-in writes a session to the keychain. Previously the
  loop baked the launch-time token into `SyncClientConfig.auth_token` and
  retried that exact value forever, so an expired access token produced an
  unrecoverable `401 → 60s backoff → 401` loop and `sync.hello` never
  arrived. See spec 183 §3.2 for the boot-gate symptom this closed.
- *Amended 2026-06-01 (reconnect-loop hardening):* `run_forever` now
  distinguishes a *recoverable* 401 from a *genuine* failure. A 401 whose
  silent refresh succeeds resets the backoff to its floor and retries
  promptly without advancing the give-up counter (that threshold means
  "service unreachable", not "session token rotated"); only transient stream
  errors, a failed refresh, or repeated 401s past a per-outage refresh budget
  (`MAX_REFRESHES_PER_OUTAGE = 3`, guarding a clock-skew hot-loop) count
  toward `DUPLEX_GIVE_UP_FAILURES`. The keychain re-read on a failed refresh
  also moved off the tokio worker via `spawn_blocking`
  (`read_session_token_from_keychain` + `StatecraftClient::adopt_token`),
  splitting the blocking OS keychain read from the in-memory token apply.
