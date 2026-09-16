---
id: "183-opc-boot-precondition-gate"
slug: opc-boot-precondition-gate
title: "OPC boot precondition gate — sidecar liveness + materialised org session, with precondition-loss restore"
status: approved
implementation: complete
owner: bart
created: "2026-05-25"
kind: governance
domain: opc
risk: medium
depends_on:
  - "032-opc-inspect-governance-wiring-mvp"  # opc-inspect-governance-wiring-mvp (the cockpit this spec gates entry to)
  - "073-axiomregent-unification"  # axiomregent-unification (the sidecar this spec asserts liveness of)
  - "087-unified-workspace-architecture"  # unified-workspace-architecture (the duplex stream whose `sync.hello` is the org-session verification anchor)
  - "106-rauthy-native-oidc-and-membership"  # rauthy-native-oidc-and-membership (the OIDC identity layer whose org claim materialises into `StatecraftState.org_id`)
  - "112-factory-project-lifecycle"  # factory-project-lifecycle (the `project.catalog.snapshot.complete` envelope is one of the org-session-verified post-handshake snapshots)
  - "133-amends-aware-coupling-gate"  # amends-aware-coupling-gate (satisfaction predicate this spec rides under)
  - "147-spec-kind-grammar"  # spec-kind-grammar (`kind: governance`)
  - "180-opc-shell-codification"  # opc-shell-codification (broad OPC shell authority; this spec sits on its Tier 1 invariant surface for a runtime-precondition concern)
code_aliases:
  - "OPC_BOOT_PRECONDITION_GATE"
extends:
  # Mechanical featuregraph-golden refresh when this spec's lifecycle
  # flipped to status: approved + implementation: complete. The
  # fixture's spec-183 record reflects this spec's frontmatter 1:1;
  # no semantic change to spec 034's claims (same precedent as
  # specs 167/168/169 carried during the 178 rename). Required by
  # spec 177 ci-orchestrator-pr-gate atomicity contract — the
  # featuregraph-golden check is a ci-gate, so lifecycle flips
  # must carry their fixture refresh inside the same PR.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
refines:
  - aspect: "boot-state-precondition-discipline"
    unit: { kind: file, path: product/apps/opc/src/App.tsx }
    refines_specs: ["180-opc-shell-codification"]
  - aspect: "sidecar-liveness-observation"
    unit: { kind: file, path: product/apps/opc/src-tauri/src/sidecars.rs }
    refines_specs: ["073-axiomregent-unification"]
  - aspect: "org-session-materialisation-observation"
    unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/statecraft_client.rs }
    refines_specs: ["087-unified-workspace-architecture"]
  - aspect: "boot-gate-org-claim-decoding-on-restore"
    unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/auth.rs }
    refines_specs: ["106-rauthy-native-oidc-and-membership"]
  - aspect: "boot-gate-auth-callback-coupling"
    unit: { kind: file, path: product/apps/opc/src/contexts/AuthContext.tsx }
    refines_specs: ["106-rauthy-native-oidc-and-membership"]
  - aspect: "sync-hello-observer-and-duplex-give-up-signal"
    unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/sync_client.rs }
    refines_specs: ["110-statecraft-to-opc-factory-trigger"]
  - aspect: "boot-gate-command-registration-and-quit-handler"
    unit: { kind: file, path: product/apps/opc/src-tauri/src/lib.rs }
    refines_specs: ["180-opc-shell-codification"]
  - aspect: "boot-gate-component-affordances"
    unit: { kind: file, path: product/apps/opc/src/components/boot/BootGate.tsx }
    refines_specs: ["180-opc-shell-codification"]
  - aspect: "boot-gate-frontend-tauri-bindings"
    unit: { kind: file, path: product/apps/opc/src/lib/api.ts }
    refines_specs: ["180-opc-shell-codification"]
  - aspect: "boot-recovery-duplex-reconnect-command"
    unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/settings.rs }
    refines_specs: ["180-opc-shell-codification"]
  - aspect: "boot-gate-command-registration-bindings"
    unit: { kind: file, path: product/apps/opc/src-tauri/src/bindings.rs }
    refines_specs: ["180-opc-shell-codification"]
  - aspect: "sidecar-hiqlite-stable-ports-and-membership-self-heal"
    unit: { kind: file, path: crates/axiomregent/src/db/mod.rs }
    refines_specs: ["073-axiomregent-unification"]
references:
  - role: parent-authority
    unit: { kind: file, path: specs/180-opc-shell-codification/spec.md }
summary: >
  Codifies the runtime preconditions that gate the OPC boot→cockpit
  transition and the precondition-loss semantics that keep the cockpit
  honest mid-session. The shell occupies a single observational *boot*
  state until two preconditions both green-light: the bundled
  axiomregent sidecar's probe port has been observed AND a TCP connection
  to that port succeeds (the diagnostic listener accepts the connection
  before closing it); and the desktop holds a materialised org session
  (`org_id` populated on the Rust-side `StatecraftState` AND a
  `sync.hello` envelope received from statecraft over the duplex stream,
  which proves the org was accepted by the server for this client).
  While in boot, the only affordances are precondition status, retry
  bound to those preconditions, a logs entrypoint, and a Quit action
  that tears down spawned sidecars cleanly. Retry is user-initiated, not
  a silent reconnect loop. If either precondition is lost mid-session
  (sidecar crash, duplex disconnect with no reconnect, org session
  expiry), the shell restores to the boot state rather than running
  degraded. Non-goals are written down explicitly: no offline mode, no
  sidecar-optional mode, no "skip for now" bypass, no per-feature
  degraded paths. The gate is the constitutional answer to a 2026-05-25
  session in which Issues 3a/6/7/8/9 surfaced as five symptoms of one
  drift — the cockpit rendered before its substrate was ready.
---

# 183 — OPC boot precondition gate

## 1. Preamble

OPC is OAP's cockpit. Without the bundled axiomregent sidecar and an
authenticated org session, every cockpit surface degrades to a different
shape of failure: factory pipelines fail with `FactoryError::NoOrgId`;
semantic search, call-graph, and checkpoint UIs error out because their
MCP routing never resolves; the project catalog stays empty because the
duplex handshake never landed; the governance panel shows "probe port
not announced yet" indefinitely. Each was previously patched
per-feature, which produced the matrix this spec retires.

The constitutional claim this spec encodes is *OPC requires
axiomregent and an authenticated org session to do its job*. The
operational expression is a boot-state gate that the shell cannot
transition out of until both preconditions verifiably hold, plus the
mid-session symmetric rule that the cockpit returns to boot on
precondition loss. Together those make boot the only "preconditions
not satisfied" state the app can occupy. Per-feature degraded modes
become inexpressible by construction; they don't need policing.

The gate is not a wall. The boot screen surfaces live status,
explicit retry controls, and a logs entrypoint so a misconfigured
proxy or a sidecar startup race is diagnosable rather than terminal.
A genuinely unrecoverable failure mode still has a Quit affordance
that cleans up the spawned sidecar before exit so the next launch
doesn't inherit ghost processes or stale port collisions.

This spec sits on spec 180's broad OPC shell authority for a
runtime-precondition concern. Spec 180 establishes authority over the
shell directories and binds Tier 1 invariants on the tab/IPC seam;
this spec adds Tier 1 invariants on the boot→cockpit transition and
the mid-session precondition-loss path. Topically adjacent, framed
separately so 180 can land as drafted without bloating its surface.

## 2. Authority enumeration

This spec does not establish new directories. It refines existing
authority on eleven files that the boot gate touches:

- `product/apps/opc/src/App.tsx` — shell entry point; gains an
  App-level component-state branch between `<BootGate>` and
  `<Cockpit>` rendering (refines spec 180's broad OPC shell
  authority).
- `product/apps/opc/src-tauri/src/sidecars.rs` — sidecar launcher;
  gains a TCP-connect liveness probe added to the existing
  port-announcement parser, plus the FR-T4 respawn helper and the
  FR-T6 Quit handler (refines spec 073's axiomregent unification
  authority). The launcher also pins a writable data directory and
  working directory on the spawned child and surfaces its stderr, so
  the bundled sidecar starts under a Finder-launched `.app` (cwd `/`)
  and a startup failure is diagnosable rather than an opaque
  "terminated code 1" (FR-T1 launch environment, below).
- `product/apps/opc/src-tauri/src/commands/statecraft_client.rs` —
  the Rust-side org-session holder; gains a "verified org session"
  observability surface keyed on `sync.hello` receipt (refines spec
  087's duplex-stream authority).
- `product/apps/opc/src/contexts/AuthContext.tsx` — frontend auth
  context; gains a tighter coupling to the Rust-side `StatecraftState`
  org_id-materialisation moment (refines spec 106's Rauthy/OIDC
  identity authority).
- `product/apps/opc/src-tauri/src/commands/sync_client.rs` — the
  duplex consumer that observes `sync.hello` (FR-T2(b) gate-flip)
  and emits the duplex give-up signal (FR-T5(b) precondition-loss)
  (refines spec 110's statecraft→OPC trigger authority). Its
  `ENVELOPE_SCHEMA_VERSION` MUST equal the server's (v2 per spec 119);
  a stale version makes every server frame — `sync.hello` included —
  fail the `is_server_envelope` guard, so FR-T2(b) can never flip
  (envelope-version parity, below).
- `product/apps/opc/src-tauri/src/lib.rs` — registers the boot-gate
  Tauri commands (`boot_gate_status`, `open_logs_folder`,
  `respawn_axiomregent`, `quit_opc`) into the invoke handler
  (refines spec 180's OPC shell authority).
- `product/apps/opc/src/components/boot/BootGate.tsx` — the consumer
  of the precondition state; renders the four FR-T3 affordances
  (refines spec 180's `src/components` directory establishment).
- `product/apps/opc/src/lib/api.ts` — frontend Tauri bindings for
  the boot-gate command surface (refines spec 180's OPC shell
  authority).
- `product/apps/opc/src-tauri/src/commands/settings.rs` — gains the
  `reconnect_statecraft_duplex` recovery command, the manual
  counterpart to the existing FR-T2(a) URL-change re-spawn; it
  re-spawns the duplex consumer to reset the per-outage refresh budget
  and force an immediate reconnect (§3.8) (refines spec 180's OPC shell
  authority).
- `product/apps/opc/src-tauri/src/bindings.rs` — registers
  `reconnect_statecraft_duplex` in the tauri-specta `collect_commands!`
  set alongside its `generate_handler!` registration in `lib.rs`
  (refines spec 180's OPC shell authority).
- `crates/axiomregent/src/db/mod.rs` — the sidecar's hiqlite
  initialiser; resolves a **stable** loopback port pair (persisted in a
  data-dir sidecar and reused every start) and self-heals any
  pre-stability store so the in-process raft client cannot flood stderr
  and evict the boot/auth diagnostics this gate depends on (§3.8) (refines
  spec 073's axiomregent unification authority).

The directory `product/apps/opc/src/components/boot/` itself remains
under spec 180's `src/components` `establishes:` claim; spec 183 adds
file-level refinement on the BootGate component within it.

### 2.1 Why `refines:`, not `establishes:`

Each file already has a primary owner (180 for `App.tsx` via its
`src/components`/`src/lib`/etc. establishes claims; 073 for the
sidecar launcher; 087 for the duplex client; 106 for AuthContext).
This spec adds a discipline on a specific aspect of each — the
boot-precondition aspect — without displacing the primary owner.
That is precisely the shape `refines:` exists for.

## 3. Tier 1 — Structural invariants

These are boolean assertions about code shape, enforceable by lint
rule, unit test, or coupling-gate edit-trigger. Each invariant cites
the path(s) it constrains.

### 3.1 Sidecar liveness gate (FR-T1)

**FR-T1.** The OPC shell MUST observe both of the following before
transitioning out of the boot state:

(a) the bundled axiomregent sidecar's `OPC_AXIOMREGENT_PORT=<n>` line
on stderr (the probe-port announcement, already parsed by
`parse_axiomregent_port_line` in `sidecars.rs`); AND

(b) a `TcpStream::connect("127.0.0.1:<n>")` call from the desktop
process succeeds — the diagnostic listener in `axiomregent/src/main.rs`
accepts the connection (and immediately drops it; payload semantics
are intentionally not part of the contract). A `ConnectionRefused`
result MUST NOT satisfy this gate even if the port number was parsed.

> *Rationale.* The probe port is purely a liveness signal. Its
> protocol is "process is running and has bound a local TCP port" —
> there is no `/health` endpoint and no JSON-RPC `initialize` round
> trip available there (MCP traffic flows over stdio, not over the
> probe port). The minimal correct green-light test is therefore TCP
> connection establishment. A sidecar that announced and then crashed
> before completing port-bind will fail connection-establishment; a
> sidecar that announced and is still running will accept it. That is
> the binary signal the gate needs.

The probe-port connection check MAY be implemented as a single TCP
connect attempt at the moment of gate evaluation (no persistent
connection, no payload). The check MUST apply a bounded connect
timeout so a hung connect does not stall the boot-screen UI. The
timeout shape is spec-bound; the timeout value is implementer's
choice (it is a latency value, not a latency invariant — §5
explicitly excludes absolute latency budgets from this spec's
binding surface).

> *Observation, not invariant.* On a healthy local sidecar the
> connect typically completes well under a second. That is a
> descriptive expectation about the OS-level loopback path, not a
> binding budget; do not read it as a Tier 3 carve-in.

**FR-T1 launch environment (binding).** The gate observes liveness; it
cannot manufacture it. The launcher MUST therefore spawn axiomregent in
an environment where it can actually start:

- A **writable data directory** — `AXIOMREGENT_DATA_DIR` resolved to the
  OPC app-data dir (with a writable working directory). axiomregent's
  default store is `<cwd>/.axiomregent/data`
  (`crates/axiomregent/src/config/mod.rs`); a Finder-launched macOS
  `.app` inherits `cwd = /`, where `init_hiqlite` cannot create its
  store and the process exits 1 *before* binding its probe port. A
  sidecar that cannot start can never satisfy (b), so the launch
  environment is part of this gate's contract, not an implementation
  detail.
- **Surfaced stderr** — the launcher MUST log the sidecar's stderr.
  Swallowing it (parsing only the `OPC_AXIOMREGENT_PORT=` line) reduces
  every startup failure to an opaque "terminated code 1" with no cause,
  defeating the diagnosability the boot screen promises (§1).

**Files FR-T1 binds on:**
- `product/apps/opc/src-tauri/src/sidecars.rs` — the announcement
  parser is here; the TCP-connect liveness check lives here or in a
  sibling file under `src-tauri/src/`.
- `product/apps/opc/src/components/boot/` (to be created) — the
  consumer of the liveness state.

### 3.2 Org-session gate (FR-T2)

**FR-T2.** The OPC shell MUST observe both of the following before
transitioning out of the boot state:

(a) `StatecraftState.org_id` is populated with a non-empty value on
the Rust side
(`product/apps/opc/src-tauri/src/commands/statecraft_client.rs`); AND

(b) the duplex client has received a `sync.hello` envelope from
statecraft for the current session (the envelope kind is owned by
spec 087; receipt is observable in
`product/apps/opc/src-tauri/src/commands/sync_client.rs`'s
`run_duplex_session`). `sync.hello` is the server's acknowledgment
that the handshake was accepted for the claimed `(clientId, orgId)`
pair — its receipt is the green-light signal that the org claim has
been *accepted by statecraft*, not merely set locally.

`is_some()` alone is insufficient: a stale, fabricated, or
not-yet-acknowledged `org_id` would pass the local-presence test
while still failing the org-scoped requests the cockpit depends on.
The `sync.hello` round trip is the cheapest verification that closes
that gap because it rides the same channel every subsequent cockpit
feature uses.

> *Rationale.* The per-feature sign-in CTA landed in commit `f9bdad30`
> is a stopgap for one symptom of this gate's absence: the user
> reaches the cockpit, clicks Start Pipeline, and the Rust factory
> context returns `FactoryError::NoOrgId`. Asserting the org session
> at boot moves the failure mode to the right place (the gate itself,
> not the feature surface) and lets the per-feature CTA be retired.

**FR-T2(b) envelope-version parity (binding).** Receipt of `sync.hello`
presupposes the desktop *accepts* the frame. The duplex consumer's
`is_server_envelope` guard enforces strict equality between the desktop's
`ENVELOPE_SCHEMA_VERSION` and the server's; spec 119 set the wire to **v2**
when it collapsed the session key from `workspace` to `org`. A desktop
pinned to a stale version rejects every server frame — `sync.hello`
included — so (b) can never flip and the gate stays closed even on a
fully authenticated, connected socket. Envelope-version parity with the
deployed server is therefore a precondition of FR-T2(b), not a separate
concern. (The desktop constant lagged at 1 while the server moved to 2;
spec 183's gate is what turned that latent skew — previously a silent
dropped frame — into a hard, observable boot block.)

**FR-T2(b) token liveness (binding, amended 2026-06-01).** Receipt of
`sync.hello` also presupposes the duplex upgrade is *authorized*. The consumer
attaches a Rauthy bearer JWT to the WebSocket handshake; statecraft's Encore
gateway rejects a missing/expired/invalid token with HTTP 401 *before* the
socket opens, so (b) can never flip. The duplex consumer therefore resolves
its bearer at connect time from the shared OS keychain and, on a 401, drives a
silent Rauthy refresh (`StatecraftClient::refresh_jwt`) before retrying —
recovering an expired access token without user action as long as the refresh
token is still valid. It also spawns whenever a Statecraft base URL is
configured (idling until sign-in materialises a session) rather than requiring
a token at launch. Before this, an expired access token loaded from the
keychain wedged the org-session gate in an unrecoverable `401 → backoff → 401`
loop with `sync.hello` never received — the precise hang this gate made
observable. Sites: `sync_client.rs::run_forever` / `connect_and_run`, `lib.rs`
(consumer spawn), `statecraft_client.rs::refresh_jwt`.

*Amended 2026-06-01 (follow-up hardening).* The recovery path above is
hardened so the gate cannot be left wedged by its own reconnect bookkeeping:
(1) a refresh-recovered 401 resets the backoff to its floor and retries
promptly without counting toward the `DUPLEX_GIVE_UP_FAILURES` threshold —
only genuine unreachability (transient errors, failed refresh, or 401s past a
per-outage refresh budget) trips the precondition-loss signal, so a routine
session rotation no longer races the gate toward give-up; and (2) the blocking
OS keychain read is moved off the tokio worker via `spawn_blocking`, split into
the free function `statecraft_client.rs::read_session_token_from_keychain`
(blocking read) and `StatecraftClient::adopt_token` (in-memory apply), so the
gate's connect loop cannot stall a worker thread on keychain I/O. Sites:
`sync_client.rs::run_forever` / `resolve_token` / `reload_session_token`,
`statecraft_client.rs::{read_session_token_from_keychain, adopt_token}`.

*Amended 2026-06-07 (server-side reconnect race — residual wedge).* The
#303/#305 fixes above are all **client-side**. A residual **server-side**
race remained: the statecraft duplex `registry` is keyed `(orgId, clientId)`
and the desktop reuses one `clientId` across reconnects, so a reconnect's
`register` installs the new session while the prior connection's `finally`
then ran a `clientId`-only `unregister` that evicted the *live* replacement —
orphaning it so its next heartbeat collapsed the stream **before `sync.hello`**,
reproducing the exact connect→close→reconnect loop this gate guards against
(every reconnect died; only a fresh first-connect ever delivered `sync.hello`).
Closed by **spec 087 FR-SYNC-011** (stream-identity-scoped teardown:
`registry.unregister(orgId, clientId, stream)` deletes only on a stream match;
`duplex.ts`'s `finally` passes its own stream). Sites:
`platform/services/statecraft/api/sync/{registry.ts, duplex.ts}`.

**FR-T2(a) in-memory propagation (binding, amended 2026-06-02).** Receipt
of a non-empty `org_id` (a) presupposes the value *propagates* to the
boot-gate reader. `boot_gate_status` reads `org_id` from the live
`StatecraftState` (`sidecars.rs::boot_gate_status`), not from the OS
keychain, so (a)'s local-presence test is only meaningful if the
sign-in's `org_id` write lands on the *same* client instance that read
serves. `StatecraftState` previously held a value-type `StatecraftClient`
whose `current()` returned a snapshot clone, and the OAuth callback
(`auth.rs::auth_handle_callback` / `auth_select_org`) mutated that
throwaway clone via `set_org_id` / `set_auth_token` without writing it
back. The keychain was updated, but the stored client's in-memory
`org_id` stayed empty — so (a) read `false` and the gate stuck at
"Waiting for statecraft duplex handshake (sync.hello)…" *even after*
`sync.hello` had been received and (b) was satisfied. A relaunch masked
it: startup's `load_token_from_keychain` repopulates the stored client.
The fix makes `StatecraftState` hold an `Arc<StatecraftClient>` so the
boot-gate reader, the duplex consumer's auth handle (FR-T2(b)), and every
authenticated REST command share ONE interior-mutable instance — a
`set_org_id` / `set_auth_token` / `adopt_token` write is visible to all of
them at once. This also closes the latent in-session REST-auth gap the
value-clone left (a fresh sign-in's token never reached REST callers until
the next launch). The `Arc` widening threads mechanically through the
`current()`-consuming call sites that take the handle by value
(`factory.rs::resolve_sc_context` and the factory dual-write paths,
`factory_platform.rs::StatecraftOidcProvider`, `settings.rs`); those edits
are pure type propagation with no behavioural change to their own domains.
Sites: `statecraft_client.rs::{StatecraftState, current, replace}`,
`lib.rs` (consumer wiring — `sc` and the duplex `auth` handle are one
shared `Arc`), `sync_client.rs::{spawn, run_forever}` (accept
`Arc<StatecraftClient>`). Regression guard: the `statecraft_client.rs`
unit test `statecraft_state_shares_one_client_across_current_handles`.

*Spawn-time binding — resolved 2026-06-02.* The Arc-sharing invariant holds
for a client's lifetime; a base-URL change swaps the instance via
`StatecraftState::replace`. `commands::settings::set_statecraft_base_url`
therefore **re-spawns the duplex consumer** against the new client (the
re-`spawn` aborts the prior loop; a cleared URL stops it via
`SyncClientState::shutdown`), so the loop follows the URL switch instead of
authenticating against the old host indefinitely. The stable `client_id`
survives the re-spawn via the `OpcInstanceId` managed state. Sites:
`settings.rs::set_statecraft_base_url`, `lib.rs` (`OpcInstanceId` manage),
`sync_client.rs::OpcInstanceId`.

*Lock-poison robustness.* `StatecraftState::{current, replace}` recover a
poisoned `RwLock` (log + `into_inner`) rather than swallowing to `None` /
dropping the write silently — a panicked holder would otherwise wedge the
boot gate and skip REST dual-write with no trace, a wider blast radius now
that all callers share one `Arc`. Guard:
`statecraft_state_recovers_from_poisoned_lock`.

**Files FR-T2 binds on:**
- `product/apps/opc/src-tauri/src/commands/statecraft_client.rs` —
  org_id residence + the verified-receipt flag.
- `product/apps/opc/src-tauri/src/commands/sync_client.rs` — the
  `sync.hello` observer that flips the verified-receipt flag.
- `product/apps/opc/src/contexts/AuthContext.tsx` — the frontend
  observer; reads via a Tauri command rather than re-deriving from
  OAuth state.
- `product/apps/opc/src/components/boot/` (to be created) — the
  consumer of the org-session state.

#### 3.2.1 Session continuity (no re-prompt while a valid token exists)

The org-session gate must not strand a *signed-in* user behind a sign-in
prompt: once a session is persisted to the OS keychain, the desktop
re-prompts only when the credential is genuinely invalid (refresh fails).
Three reinforcements keep `org_session_ready` reachable from a saved
session without user re-entry:

- **Keychain survives a same-server settings save.**
  `set_statecraft_base_url` clears the keychain and forces re-auth only on
  a *genuine* base-URL change; a same-server re-save keeps the session and
  reloads it onto the freshly-built `StatecraftClient` (a new client starts
  with empty `auth_token`/`org_id`, which would otherwise wedge the gate).
- **`auth_get_status` is self-healing.** On an expired access token it
  attempts a silent `refresh_jwt` before reporting `authenticated: false`,
  and on a valid token it adopts it onto the in-memory client when
  `org_id` is empty — so the gate's `org_id` read reflects the saved
  session even on a warm path that never ran a fresh sign-in.
- **Background refresh is surfaced.** When the duplex loop silently
  refreshes an expired bearer (`sync_client.rs`), it emits a
  `session-refreshed` event; `AuthContext` re-checks status on it instead
  of leaving a stale "Sign in" prompt for a session that was just
  recovered.

### 3.3 Observational boot state (FR-T3)

**FR-T3.** While in the boot state, the shell MUST render ONLY a
boot-state UI surface (the `<BootGate>` component) whose affordances
are restricted to:

- precondition status (sidecar status row; sign-in / org-session
  status row);
- retry controls bound to those preconditions (Retry sidecar; and the
  contextual auth controls Sign in to statecraft / Sign out — see the
  2026-06-04 sub-clause below);
- a logs entrypoint (Open logs);
- a Quit action.

No tabs, no recent-projects list, no settings panel beyond what the
precondition controls require, no "skip for now" control, no
degraded-mode entry. State change in the boot surface MUST be
confined to the `<BootGate>` component subtree; the rest of the tab
system, store layer, and route tree MUST NOT mount or read state
from within boot.

**FR-T3 contextual auth controls + titlebar nav suppression (binding,
added 2026-06-04).** Two refinements of the affordance set land
together:

1. *Contextual sign-in / sign-out.* The org-session status row exposes
   **Sign in** when the session is `unauthenticated` and **Sign out**
   whenever a session exists — including the authenticated-but-no-org
   state where `org_session_ready` never flips because the gate's
   `has_org` term stays false (the keychain-restored JWT carried no
   `oap_org_id` claim, so `StatecraftClient::apply_token` left `org_id`
   empty). Sign out routes through `auth_logout` →
   `StatecraftClient::clear_auth()`, which clears the in-memory token
   AND the OS-keychain `session` entry, so the next sign-in re-runs the
   interactive org-resolution path (`auth_handle_callback` /
   `auth_select_org` write `org_id` *directly*) rather than depending on
   the claim. Before this, a user stranded in that state had no
   boot-surface affordance to recover: the row showed only the
   "Waiting for … sync.hello" line and a sign-in CTA gated on
   `unauthenticated`, neither of which fires while
   `status === 'authenticated'`. The status line is also now keyed on
   `BootGateStatus.org_id` so it stops misattributing the stall: since
   `org_session_ready == has_org && sync_hello`, an absent `org_id`
   means `has_org` is the unmet term, so the line names that blocker
   ("no organisation attached to this session — sign out and back in to
   re-resolve") instead of blaming a `sync.hello` handshake that may
   already have completed; the handshake wording shows only when
   `org_id` is present (so `sync.hello` is genuinely the term in
   flight).

2. *Titlebar nav suppression.* The "render ONLY a boot-state UI surface"
   invariant binds the window titlebar too. The `CustomTitlebar`
   right-side cluster targets cockpit surfaces (Workspace Projects,
   Factory, Usage, Settings, MCP, Agents); those are not boot-state
   affordances. Presenting them clickable during boot was a latent
   erosion of the invariant — a cockpit-navigation escape hatch
   reachable before preconditions pass. The cluster is therefore hidden
   entirely until App reports the boot→cockpit flip (`navEnabled =
   bootGateOpen`). The titlebar file itself (`CustomTitlebar.tsx`) is
   under spec 180's broad `src/components` shell authority; this spec
   owns only the *invariant* that drives its visibility, threaded from
   `App.tsx`. See spec 180 §2.2 for the surface-side record.

**Files this sub-clause additionally touches:**
- `product/apps/opc/src/components/boot/BootGate.tsx` — the contextual
  Sign in / Sign out controls (already FR-T3-bound above).
- `product/apps/opc/src/App.tsx` — passes `navEnabled={bootGateOpen}`
  (already FR-T3-bound above).
- `product/apps/opc/src/components/CustomTitlebar.tsx` — the suppressed
  nav cluster; authority remains spec 180's (surface), this spec's
  binding is the FR-T3 invariant only (documented in prose, not a
  frontmatter authority edge).

**Implementation shape (binding):** boot vs. cockpit MUST be an
App-level component-state branch in `src/App.tsx` (i.e.,
`<BootGate>` OR `<Cockpit>` rendered as an outer conditional), NOT
a route under `src/routes/` (e.g., `/boot`). A route-driven boot
state cannot structurally enforce "the rest of the route tree is
not observable from within boot," because the route tree must
exist to host the boot route alongside the rest. Only an outer
conditional render achieves the invariant.

> *Rationale.* The constitutional claim is "boot is the only state
> the app can occupy until preconditions pass." Letting the boot
> state share UI with the cockpit (recent projects, settings tweaks)
> erodes the invariant by surface area. Constrain boot to a single
> observational surface so a future "lightweight OPC" proposal must
> amend an invariant, not just merge a flag.

**Files FR-T3 binds on:**
- `product/apps/opc/src/App.tsx` — the conditional render boundary.
- `product/apps/opc/src/components/boot/` (to be created) — the
  `<BootGate>` component subtree; this directory MUST NOT mount any
  cockpit surface (no `TabManager`, no `ProjectList`, no
  `MCPManager`, no `Settings`, etc.) directly or transitively.

### 3.4 Bounded explicit retry (FR-T4)

**FR-T4.** Boot-state retry of a failed precondition MUST be
user-initiated (button click) rather than a silent reconnect loop.
Retry attempts MAY surface inline progress (e.g., `attempt 3,
waiting for port announce…`) but MUST NOT cycle without user
action. After N retry failures (implementer's choice; not
spec-bound) the boot screen MUST surface the logs entrypoint more
prominently; it MUST NOT escalate to forced Quit.

> *Rationale.* Inside a running app, silent retry is a conservative
> recovery posture (this is what the cockpit's auto-poll in commit
> `993de5ae` does, and that is the right shape *there*). At boot,
> silent retry creates a confusing wall — the user doesn't know
> whether to wait, restart, or check logs. Explicit retry teaches
> the failure-mode pattern (boot blocked → user acts) and matches
> the real-world-class failure modes (corporate
> proxy ate the request, port collision, ghost process) where the
> user is the right authority on whether to give up.

**Files FR-T4 binds on:**
- `product/apps/opc/src/components/boot/` (to be created) — the
  retry-button affordances and the inline-status surface.

### 3.5 Precondition-loss restore to boot (FR-T5)

**FR-T5.** If, after a successful boot→cockpit transition, either
precondition is observed lost, the shell MUST restore to the boot
state. The observable losses are:

(a) the bundled axiomregent sidecar terminates (the desktop sees
`CommandEvent::Terminated` from the shell sidecar handle in
`sidecars.rs`) — this lapses FR-T1;

(b) the duplex client reports persistent reconnect failure. The
desktop's `run_forever` reconnect loop in `sync_client.rs` retries
without an intrinsic exhaustion bound, so this invariant requires
that the loop expose a "give-up signal" — a state transition the
implementer wires when reconnect attempts exceed an implementer-
chosen threshold (count, elapsed time, or backoff ceiling reached;
the threshold value is not spec-bound). The boot-gate consumer
subscribes to that signal. A single disconnect that the reconnect
loop recovers from before the threshold MUST NOT trigger restore;
crossing the threshold MUST. This lapses FR-T2(b);

(c) `StatecraftState.org_id` is cleared (e.g., explicit logout, or
the auth refresh path determines the session is irrecoverable) —
this lapses FR-T2(a).

Restore semantics: the cockpit subtree unmounts, the `<BootGate>`
subtree mounts in its place with retry affordances appropriate to
the lost precondition pre-selected, and any in-flight cockpit
operations (factory runs, MCP calls, etc.) MUST be cancelled or
allowed to error out into the user surface — they MUST NOT continue
silently behind the boot screen.

> *Rationale.* Without FR-T5, the spec is one-shot at startup and
> silent on the steady state. A sidecar crash mid-session would leave
> the cockpit running in exactly the degraded state the spec exists
> to forbid, and per-feature code would re-acquire the matrix of
> ad-hoc fallbacks. FR-T5 closes that seam: the boot state is the
> *only* "preconditions not satisfied" state, full-stop, regardless
> of whether the cockpit ever rendered.

**Files FR-T5 binds on:**
- `product/apps/opc/src-tauri/src/sidecars.rs` — sidecar termination
  observer (CommandEvent::Terminated propagation to the boot-gate
  consumer).
- `product/apps/opc/src-tauri/src/commands/sync_client.rs` — the
  reconnect-window-exceeded signal.
- `product/apps/opc/src-tauri/src/commands/statecraft_client.rs` —
  org_id-cleared observer.
- `product/apps/opc/src/App.tsx` — the conditional render boundary
  that flips back to `<BootGate>`.

### 3.6 Quit affordance — clean sidecar teardown (FR-T6)

**FR-T6.** When the user invokes Quit from the boot state (or the
restored-to-boot state under FR-T5), the shell MUST tear down all
spawned sidecars before the desktop process exits. A graceful SIGTERM
attempt with a short timeout (implementer's choice, e.g. 2s), followed
by SIGKILL on timeout, is acceptable. The Quit handler MUST NOT
return until the sidecar handle reports termination (or the timeout
elapses); it MUST NOT leave the process tree in a state where the
next OPC launch could collide on the same probe port or inherit a
stale lockfile.

> *Rationale.* A Quit that orphans the axiomregent process is a
> footgun on the next launch — port collisions, stale lockfiles,
> ghost processes that hold open files the new sidecar wants. A
> single line of teardown discipline forecloses an entire class of
> "OPC won't start after I quit it" bug reports.

**Files FR-T6 binds on:**
- `product/apps/opc/src-tauri/src/sidecars.rs` — the teardown
  helper (must hold the sidecar `Child` handle or its equivalent
  long enough to invoke kill on Quit; today `spawn_axiomregent`
  drops the child after parsing the port line, which is a
  precondition-restore bug independent of this spec but blocking
  for FR-T6).
- `product/apps/opc/src-tauri/src/lib.rs` — the Quit handler /
  app-exit hook that calls the teardown helper.

### 3.7 Post-approval hardening: consumer-spawn ordering (2026-06-05)

FR-T2(b) makes a received `sync.hello` envelope the proof that the org
session is live. That proof can only arrive if the duplex reconnect
loop (`sync_client.rs::run_forever`) actually starts. A runtime
investigation on 2026-06-05 found a startup ordering race that could
prevent it from starting at all:

- `lib.rs` spawned the duplex consumer task *before* calling
  `app.manage(SyncClientState)`. The spawned task resolved that state
  with the **panicking** `Manager::state()` accessor. On Tauri's
  multi-threaded async runtime a worker could poll the task before the
  manage ran, panicking it; `tauri::async_runtime::spawn` drops the
  `JoinHandle`, so the panic was swallowed — `run_forever` never
  executed, no connect was attempted, and the only evidence was a lone
  `sync_client: duplex consumer starting` log with no `connecting` /
  `idle` follow-up. The boot gate then waited on `sync.hello` forever;
  because nothing re-spawns a dead consumer, a sign-out / sign-in could
  not recover it — only a full relaunch (which re-rolled the race)
  would.

This is an intermittent failure of the FR-T2(b) precondition's
*liveness*, not its logic. The hardening, confined to the files this
spec already `refines:`:

1. **`lib.rs` — manage before spawn.** `app.manage(SyncClientState)`
   is moved above the consumer spawn, and the spawned task resolves the
   state with the non-panicking `try_state()` plus a bounded retry and
   an error log. A narrow ordering window can no longer silently kill
   the consumer.
2. **`sync_client.rs` — loop-entry log.** `run_forever` logs once on
   entry, so "task died before the loop" is always distinguishable from
   "loop running but token resolution stalled". The boot gate's
   `sync.hello` source is never again silent.

No FR-T2 invariant changes — this restores the assumed liveness of the
loop the invariant already depends on. The duplex give-up /
precondition-loss semantics (FR-T5) are unchanged.

### 3.8 Post-approval hardening: explicit reconnect, sign-in budget reset, and port-0 self-heal (2026-06-05)

The 2026-06-05 runtime investigation surfaced three further liveness
gaps around the same FR-T2(b) `sync.hello` precondition. Like §3.7, each
is confined to files this spec `refines:` and changes no FR-T invariant —
they restore liveness the invariants already assume.

**(a) Explicit duplex reconnect (recovery, not silent retry).** §3.2's
recovery diagnosis (2026-06-01) bounded the duplex 401→refresh loop with
a per-outage refresh budget (`MAX_REFRESHES_PER_OUTAGE`), and §3.7 fixed
the spawn race. But three states could still strand a signed-in user on
the boot gate with `has_org` satisfied and `sync.hello` never arriving:
a refresh budget burned during a session expiry (the budget resets only
on a *clean* connect, so a subsequently re-minted valid bearer's upgrade
401s would skip the refresh path and march to give-up); a consumer
sitting out a long backoff after a transient outage; or — belt-and-braces
over §3.7 — a wedged consumer. The recovery is a re-spawn: `run_forever`
holds the budget and failure counters as loop-locals, so a fresh spawn
starts them at zero and connects immediately with the current bearer.

A new `reconnect_statecraft_duplex` Tauri command
(`commands/settings.rs`, registered in `bindings.rs` + `lib.rs`) exposes
exactly the FR-T2(a) URL-change re-spawn as a user/-caller action.
`BootGate.tsx` surfaces it as a **Reconnect** affordance in precisely the
`has_org`-satisfied-but-no-`sync.hello` branch — the diagnosed
duplex-stuck state — so it sits beside the existing Sign-out recovery for
the org-absent branch. This stays within FR-T4's "retry is
user-initiated, not a silent reconnect loop": Reconnect is an explicit
button, and the underlying loop's backoff cadence is unchanged.

**(b) Refresh-budget reset on sign-in.** A fresh sign-in (or an org
selection / switch) establishes a new valid bearer, so `AuthContext.tsx`
fires the same `reconnect_statecraft_duplex` on its authenticated
transition. This guarantees the per-outage refresh budget resets when a
new session is established, closing the "re-login is unrecoverable after
a burned budget" seam without waiting for the loop's own clean-connect
reset. Best-effort and desktop-only — a failed reconnect never blocks the
sign-in transition.

**(c) Sidecar hiqlite stable loopback ports + membership self-heal.**
FR-T1 depends on a *diagnosable* sidecar, and FR-T2(b)'s `sync.hello`
failures are diagnosed from `opc.log`. hiqlite/openraft freezes the
single-node raft+api addresses in committed membership at first init and
reloads them on every restart, while the in-process API client dials the
committed `addr_api` for its background WS stream. **The node address must
therefore be stable across restarts.** Two iterations of this fix:

- *First iteration (the `:0` self-heal, #274/#275 + #305).* A pre-fix
  binary advertised `127.0.0.1:0`; the committed `:0` reloaded forever and
  the client flooded stderr with `os error 49` ~once per second, evicting
  the very duplex/auth lines a stuck-handshake diagnosis needs. A startup
  heal moved a `:0`-poisoned dir aside. But this only neutralised the
  *literal* `:0` signature.

- *Second iteration (this change).* The deeper defect: `init_hiqlite`
  resolved a **fresh ephemeral port every start** via `free_loopback_pair`,
  so after the first run the committed port and the bound port diverged and
  the client flooded the *same* way — `Connection refused`, `os error 61` —
  dialing a stale *concrete* port the `:0` heal deemed "healthy". A
  data-dir reset was only a one-shot (the next launch re-diverged).
  `init_hiqlite` now persists the resolved `(raft, api)` pair in a
  data-dir sidecar (`.opc-hiqlite-ports.json`) and **reuses it every
  start**, so `NodeConfig.addr_api` always equals committed membership and
  the client never dials a stale port. The self-heal is generalised: any
  store that is *initialised but carries no ports sidecar* (every
  pre-stability store, the `:0` case included) is moved **aside** (a
  numbered sibling, preserved not deleted — the store is a regenerable
  checkpoint/cache per spec 041) so the next init claims a stable pair. A
  current-binary store (sidecar present) and a pristine dir are never
  touched.

These restore the liveness and observability the FR-T1/FR-T2 invariants
assume; the precondition-loss semantics (FR-T5) are unchanged.

### 3.9 Post-approval hardening: org-claim decoding on keychain restore (2026-06-08)

The §3.7/§3.8 persistence work made the Statecraft session survive a
restart — the JWT is restored from the OS keychain on launch. That
exposed a long-latent decoding defect on the same FR-T2(b)
`org_id`-materialisation path. Rauthy emits the OAP attributes
(`oap_org_id`, `oap_user_id`, `oap_org_slug`, …) nested under a top-level
`custom` object in the minted JWT (see statecraft
`api/auth/sessionMint.ts` and the `oap` scope's `attr_include_access`
mapping in `scripts/seed-rauthy.mjs`), but the OPC Rust read them at the
**top level**. So `apply_token` (`commands/statecraft_client.rs`) derived
an empty `org_id` from every keychain-restored / refreshed token, the
gate's `has_org` term never flipped, and the cockpit never opened on cold
start — the user had to sign out and sign in again on every launch. A
fresh sign-in masked the defect because `auth_handle_callback` /
`auth_select_org` set `org_id` from the HTTP **response body**, never the
JWT; only the restore path reads the claim.

The fix is a `custom`-aware claim accessor (`claim_str`: reads
`custom.<key>` first, falls back to top-level for forward-compat), routed
through `apply_token` and through `auth_get_status` / `auth_switch_org`
(`commands/auth.rs`) so a restored session reports its org and identity,
not just an authenticated-but-empty shell. `auth.rs` joins this spec's
`refines:` set under the same org-session-materialisation concern the boot
gate already observes on `statecraft_client.rs` — it is the auth-command
half of that one discipline. The duplex still connected on restart
throughout (the server resolves org from the JWT server-side), so this was
purely a client-side derivation defect, distinct from the §3.7/§3.8
liveness gaps. No FR-T invariant changes; this restores the `org_id`
materialisation FR-T2(b) already assumes. The prior unit test used a
flat-claim fixture — exactly what let the defect ship; the regression now
pins the real nested wire shape.

## 4. Non-goals (binding)

These are written down to constrain future drift. A change that
contradicts any of them amends the corresponding invariant, not the
implementation.

- **No offline mode.** OPC has no mode in which it operates without
  a reachable axiomregent sidecar AND a materialised org session.
  A future "browse local projects without signing in" proposal
  amends FR-T2; it does not add a flag.
- **No sidecar-optional mode.** The bundled sidecar is a hard
  dependency. An external axiomregent instance MAY substitute for
  it (the gate checks the announced port responds, not which
  process produced the announcement), but zero-axiomregent
  operation is not a supported mode.
- **No "skip for now" boot bypass.** The shell MUST NOT expose a
  control that transitions out of boot without satisfying FR-T1 +
  FR-T2. A future demo-mode proposal amends FR-T3; it does not add
  a flag.
- **No degraded operation.** Cockpit features (factory, semantic
  search, call graph, checkpoint, MCP routing) MUST NOT carry their
  own "is axiomregent available?" or "is org session live?"
  fallback paths. The boot gate already asserts availability via
  FR-T1/T2; FR-T5 enforces the symmetric mid-session invariant.
  Per-feature fallback would reintroduce the matrix of degraded
  states this spec exists to remove.
- **No silent boot retry.** Per FR-T4, retry is user-initiated. A
  future auto-retry-at-boot proposal amends FR-T4; it does not add
  a poll interval to the boot gate.

## 5. Tier 3 exclusion

Absolute latency budgets for the boot→cockpit transition ("must
complete in <X seconds") are explicitly out of scope. Sidecar
startup time varies with cold-launch I/O pressure, anti-virus scan
on the bundled binary, and the user's existing process tree. The
correct boot-UX response is to surface progress (FR-T4) rather than
fail on a latency budget that flakes on slow machines.

The same reasoning excludes absolute thresholds for retry
backoff cadence — FR-T4 binds shape (user-initiated, no silent
loop), not timing.

## 6. Acceptance

- **AC-1.** Spec frontmatter declares `kind: governance`, `domain:
  opc`. The relationship-graph fields (`refines`, `references`,
  `depends_on`) are populated per §2. `code_aliases` includes
  `OPC_BOOT_PRECONDITION_GATE`.
- **AC-2.** `spec-lint` does not regress; **V-020** does not fire on
  this spec (every relationship-graph field is explicitly declared).
- **AC-3.** `make pr-prep` exits clean against `origin/main` with
  this spec.md as the sole new authored artifact, the regenerated
  `.derived/codebase-index/index.json`, AND — exempted from "no
  substantive edits to other specs' bodies" — forward-edge additions
  to an upstream spec's §8 Future Work section that point at this
  spec (specifically the `[[opc-boot-precondition-gate]]` pointer
  landed in spec 180 §8). Forward-edge pointers are not substantive
  edits to the upstream spec's design; they are discoverability
  affordances. No `oap.spec` manifest changes; no edits to upstream
  spec bodies outside §8 Future Work.
- **AC-4.** `registry-consumer by-authority` returns
  `183-opc-boot-precondition-gate` for each path this spec claims a
  `refines:` aspect on:

  ```bash
  registry-consumer by-authority product/apps/opc/src/App.tsx
  registry-consumer by-authority product/apps/opc/src-tauri/src/sidecars.rs
  registry-consumer by-authority product/apps/opc/src-tauri/src/commands/statecraft_client.rs
  registry-consumer by-authority product/apps/opc/src/contexts/AuthContext.tsx
  ```

  Each query returns this spec alongside the primary owner declared
  by the upstream spec (180, 073, 087, 106).
- **AC-5.** A unit / integration test asserts FR-T1 directly: a
  test fixture that announces a port but then closes the listener
  MUST be rejected by the liveness probe; a fixture that announces
  and keeps the listener open MUST be accepted. This is the
  observable contract that distinguishes "port parsed" from "port
  parsed + still serving."
- **AC-6.** A unit / integration test asserts FR-T2(b): a
  `sync.hello` envelope must be observable before the org-session
  gate flips. Statecraft already emits `sync.hello` on accepted
  handshake (`api/sync/duplex.ts` line 121, kind `sync.hello`); the
  test fixture exercises the desktop's observer in `sync_client.rs`.
- **AC-7.** An end-to-end assertion on a built OPC: with the
  sidecar binary present but statecraft unreachable, the boot screen
  MUST render and remain rendered (FR-T1 passes via TCP-connect to
  the local probe; FR-T2 stalls on `sync.hello` and the boot screen
  surfaces the sign-in / connection failure). The cockpit MUST NOT
  appear under these conditions. This is the load-bearing assertion
  for the constitutional claim.
- **AC-8.** An end-to-end assertion on a built OPC: starting from a
  fully-signed-in cockpit, killing the axiomregent process MUST
  cause the cockpit to unmount and the boot screen to mount in its
  place within an implementer-bounded window (e.g., 2s of the
  `CommandEvent::Terminated` observation). This is the FR-T5
  observability test.
- **AC-9.** An end-to-end assertion: invoking Quit from the boot
  screen MUST leave no axiomregent process running on the system
  (assert by polling `ps` or its equivalent for a window after
  exit). This is the FR-T6 cleanup test.

AC-7, AC-8, AC-9 are end-to-end and may be gated as nightly /
manual rather than per-PR; AC-5 and AC-6 are unit-test-shaped and
SHOULD ride per-PR.

## 7. Out of scope (and why)

- **Boot-state UI styling beyond the four affordances.** Layout,
  colour, animation are implementer's choice. The spec binds
  *which* affordances exist, not how they look. (Earlier draft
  carried a mock; the row-label conventions noted on review will
  inform implementation but are not spec-bound.)
- **MCP routing implementation for Semantic Search / Call Graph /
  Checkpoint.** These features need an MCP stdio-framed client in
  the desktop shell to reach axiomregent's tool providers. Building
  that client is a separate spec / unit of work; this gate
  *enables* it (by guaranteeing the sidecar is alive when the
  cockpit renders) but does not specify it.
- **External-axiomregent substitution.** A future "use my own
  axiomregent" mode (point the boot gate at a non-bundled
  instance's probe port) is consistent with the non-goal "an
  external instance MAY substitute" but specifying its config
  surface is out of scope here.
- **Pre-boot diagnostics.** A future "OPC won't start at all"
  surface (before even the boot screen renders, e.g., for fatal
  bundled-binary corruption) is out of scope; the boot screen
  itself is the diagnostic surface for the failure modes this
  spec contemplates.

## 8. Future work

- `[[opc-mcp-stdio-router]]` — the desktop-side MCP stdio client
  that multiplexes UI requests through the axiomregent sidecar's
  stdin/stdout. Unblocked by this spec's FR-T1; replaces the
  hard-coded "not available in this build" errors in
  `SemanticSearchPanel.tsx`, `CallGraphPanel.tsx`,
  `useCheckpointFlow.ts`, and retires the
  `mcp_call_tool` stub at `commands/mcp.rs:91`.
- `[[opc-external-axiomregent-mode]]` — config-surface spec for
  pointing the boot gate at a non-bundled axiomregent instance,
  consistent with the §4 "external instance MAY substitute"
  non-goal carve-out.
- `[[opc-boot-telemetry]]` — should boot-gate transitions emit a
  governance event (transition time, retry count, precondition-loss
  cause), and if so where it lands.

## 9. Cross-references

- **Spec 032** — OPC inspect+governance MVP; the cockpit this spec
  gates entry into.
- **Spec 073** — axiomregent unification; the sidecar this spec
  asserts liveness of.
- **Spec 087** — unified workspace architecture; defines the duplex
  stream and the `sync.hello` envelope this spec uses as the
  org-session verification anchor.
- **Spec 106** — Rauthy native OIDC and membership; the identity
  layer whose org claim materialises into `StatecraftState.org_id`.
- **Spec 112** — factory project lifecycle; the
  `project.catalog.snapshot.complete` envelope (added 2026-05-25)
  is one of the post-handshake snapshots that ride the
  org-session-verified path FR-T2 asserts.
- **Spec 133** — amends-aware coupling gate; the satisfaction
  predicate this spec rides under for `refines:` edits.
- **Spec 147** — spec-kind grammar; `kind: governance` is the fit
  per the 132/153/180 precedent for invariant-binding governance
  specs.
- **Spec 180** — OPC shell codification; this spec sits on 180's
  broad OPC authority for a runtime-precondition concern. 180 §8
  future-work entry `[[opc-boot-precondition-gate]]` points here.
