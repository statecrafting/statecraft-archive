# T006 working contract — gitctx + `@opc/mcp-client` (PR-4 gate)

**Feature:** `032-opc-inspect-governance-wiring-mvp`  
**Task:** T006 — Complete frontend MCP path used by the git context panel  
**Status:** **Merged to `main` via [PR #4](https://github.com/statecrafting/open-agentic-platform/pull/4)** (2026-03-26). This document remains the **T006** contract reference for reviewers and follow-up work.

**Related:** `tasks.md` (T006), `plan.md`, `execution/verification.md`

### PR-4: Chosen decisions (copy into PR description)

Reviewers use this to avoid mid-PR drift. **Paste into the PR body** and keep it aligned with the code.

```markdown
### Chosen decisions (T006 / PR-4)

- **Transport owner:** B — Rust proxy only (`mcp_list_tools` / `mcp_call_tool` / `mcp_read_resource`); `@opc/mcp-client` wraps Tauri `invoke` only.
- **gitctx transport mode:** Per-request **stdio** MCP to the bundled `gitctx-mcp` binary (`execute_gitctx_rpc` in `commands/mcp.rs`). No localhost MCP socket for gitctx in this slice.
- **gitctx spawn policy:** No long-lived `gitctx-mcp` sidecar for port discovery; each MCP round-trip spawns a short-lived child. **axiomregent** may still use port discovery separately (`get_sidecar_ports` → `axiomregent` only).
- **Reconnect policy:** N/A for gitctx long-lived sessions; failures map to degraded enrichment on the next user refresh. Optional follow-up: connection pooling or a single long-lived child if latency becomes an issue.
```

### PR: Runtime model (copy into PR description — post-unification)

```markdown
### Runtime model

- gitctx MCP is Rust-owned and executes through a per-request stdio bridge in `commands/mcp.rs`.
- `get_sidecar_ports` is not used for gitctx; port discovery remains only for sidecars that actually announce ports, such as axiomregent.
- Desktop enrichment readiness is defined by the result of the MCP bridge call itself.
- Native git remains source-of-truth for branch, dirty state, and ahead/behind; gitctx is additive enrichment only.

**Reviewer one-liner:** This PR unifies gitctx on a single Rust-owned per-request stdio MCP path and keeps native git authoritative, with gitctx acting only as additive enrichment.
```

---

## Why this exists

- **gitctx in the desktop app must have one clear execution story** — Rust-owned MCP over stdio to the bundled binary — so `@opc/mcp-client` is not a fake browser stdio client and reviewers can validate a real path end-to-end.
- This file locks **reviewable acceptance criteria** for a seam-heavy integration slice and prevents “misc MCP fixes” from substituting for an end-to-end contract.

---

## Lock before any implementation starts

Decisions **must** be written down (e.g. ADR snippet in PR description or comments on the chosen modules). **Do not merge half of each pattern.**

### 1. Transport ownership

| Option | Meaning |
|--------|---------|
| **A — TS owns transport** | TypeScript connects to a localhost MCP transport. **Not used** for gitctx in the current slice. |
| **B — Rust owns transport** | Tauri commands proxy MCP; the webview calls **only** Tauri commands. `@opc/mcp-client` is a thin typed wrapper around `invoke`, **not** a second HTTP/WebSocket client to a sidecar port. |

**Current choice:** **B** for gitctx. **Forbidden:** TS opening localhost to gitctx *and* a parallel Rust path without deprecating one.

### 2. gitctx execution contract (Rust binary + desktop bridge)

- **`gitctx-mcp`** speaks MCP over **stdio** (standard for CLI MCP servers). Desktop **`execute_gitctx_rpc`** spawns the bundled binary, sends framed JSON-RPC (`initialize` + method), reads the response, exits the child.
- **No `OPC_GITCTX_PORT` / no gitctx entry in `SidecarPorts`** for this model — readiness for enrichment is **the outcome of a successful bridge call** (e.g. `resources/read`), not a separate port probe.

---

## PR-4 implementation order (landed / recommended)

1. **Rust bridge:** `execute_gitctx_rpc` + `mcp_list_tools` / `mcp_call_tool` / `mcp_read_resource` (gitctx-only scope).
2. **`@opc/mcp-client`:** typed wrapper over those commands (no `@modelcontextprotocol/sdk` in the webview for this path).
3. **Desktop hook:** call `readResource("gitctx://context/current")` when native git panel has data; **do not** gate on `getSidecarPorts` for gitctx.
4. **Additive UI:** merge enrichment into the git panel; native git remains source-of-truth.
5. **Governance** and unrelated MCP surfaces **out of scope** (see Non-goals).

---

## Semantic rule: native git is source of truth (PR-3 preserved)

**Authoritative in T006 for “core repo state” (must not be semantically undermined by PR-4):**

- Branch (or detached HEAD handling)
- Dirty / clean (working tree)
- Ahead / behind (with existing degraded semantics when upstream missing)

**gitctx contributes only enrichment**, for example:

- GitHub / repo identity context from `gitctx://context/current`
- Anything **beyond** the current local snapshot that native git already shows

If sidecar data conflicts with local git, **local wins**; UI shows enrichment as degraded or absent, not as a second truth for branch/dirty/ahead-behind.

---

## Acceptance criteria (PR-4 merge)

### Package and workspace

1. **`@opc/mcp-client`** exposes a real public API (`createMcpClient`, `readResource` / `callTool` / `listTools`) — not a stub with only `initialize()`.
2. **`apps/desktop`** declares a `workspace:*` dependency on `@opc/mcp-client` and uses it through that API (no scattered ad-hoc `invoke("mcp_…")` in UI components).
3. **Dependencies:** `@opc/mcp-client` uses **`@tauri-apps/api`** for `invoke` (pinned range in `package.json`). No unbounded `latest` for critical deps.

### Lifecycle (gitctx)

4. **Single execution path:** MCP for gitctx goes through **`execute_gitctx_rpc`** (per-request stdio child). No parallel long-lived gitctx sidecar + port discovery for readiness.
5. **`get_sidecar_ports`:** applies to **axiomregent** (and any future port-announcing sidecars), **not** gitctx in the unified model.
6. **Timeouts** on MCP round-trips used by the git panel path (enforced in Rust bridge).

### Errors and UI

7. **Typed / classified errors** on the TS side where practical (`McpClientError`); safe UI copy for users.
8. **Enrichment failures** must **not** force the whole panel into error if native git already succeeded; show **degraded** enrichment, not panel collapse.
9. **Request/response typing:** `readResource` for `gitctx://context/current` parsed into a dedicated TS type (`GitCtxEnrichment`); avoid leaking raw `unknown` into presentation logic.

### Tests / verification

10. **Tests or manual verification:** gitctx absent (binary missing / spawn error) → degraded enrichment; gitctx available → enrichment section populates; partial payload → degraded, not crash.
11. **Record** T006 verification steps in `execution/verification.md` when implementing.

### Spec hygiene

12. **`tasks.md` paths:** keep file references accurate (`GitContextPanel` vs `features/git/*` as in repo).

---

## Non-goals (explicitly out of scope for T006 / PR-4)

- **Governance panel** integration or wiring `@opc/mcp-client` for governance flows.
- **Axiomregent** MCP completion beyond existing port discovery (if present).
- **Generic multi-server MCP abstraction** beyond what **gitctx** needs for the git context journey.
- **Long-lived gitctx TCP/SSE transport** on a discovered port — optional future slice if product requires it.

---

## Runtime model — gitctx (unified for this slice)

- **Ownership:** Rust **`commands/mcp.rs`** owns gitctx MCP lifecycle per request (stdio child).
- **Readiness:** Same as **successful execution** of the bridge for that request; the UI does not poll `getSidecarPorts` for gitctx.
- **Native git** remains authoritative; gitctx is additive only.

---

## Repo facts snapshot (for reviewers)

- **`execute_gitctx_rpc()`** runs active MCP requests via a **Rust-owned per-request stdio** bridge to the bundled `gitctx-mcp`.
- **No `spawn_gitctx()`** and **no `OPC_GITCTX_PORT`** for gitctx; **`SidecarPorts` has no `gitctx` field** — port discovery is for other sidecars (e.g. axiomregent), not gitctx.
- **Desktop git UI** loads gitctx through **`@opc/mcp-client` → Tauri MCP commands** as **optional enrichment** only.
- **Native git commands** remain source-of-truth for branch, dirty state, and ahead/behind.
- **gitctx failures** surface as **degraded** enrichment (and warnings when combined with native partial data); they **must not** break core git panel rendering.

---

## PR-4 gate

**Merge PR-4 when:** transport ownership is **one** coherent story for gitctx (Rust stdio bridge + typed client wrapper), acceptance criteria are met, non-goals are respected, and verification is recorded.
