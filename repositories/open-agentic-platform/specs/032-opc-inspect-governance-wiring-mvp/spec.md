---
id: "032-opc-inspect-governance-wiring-mvp"
title: "OPC inspect + governance wiring MVP"
feature_branch: "032-opc-inspect-governance-wiring-mvp"
status: approved
implementation: complete
kind: product-consolidation
domain: opc
created: "2026-03-23"
authors:
  - "open-agentic-platform"
language: en
summary: >
  First product-facing OAP vertical slice: wire OPC inspect and governance UI
  surfaces to existing sidecar and local analysis capabilities so one end-to-end
  user journey works without placeholders.
code_aliases:
  - XRAY_ANALYSIS
  - XRAY_SCAN_POLICY
origin:
  retroactive: true
---

# Feature Specification: OPC inspect + governance wiring

## Purpose

Deliver the first real open-agentic-platform product slice by wiring existing OPC capability into a coherent desktop inspect flow:

Inspect repo -> understand git + governance state -> take one real action.

## Scope

This feature is the first governed product-facing consolidation slice after contract/governance substrate completion.

In scope:

- Inspect entrypoint and inspect surface wiring in OPC UI
- Live git context panel: native git as source-of-truth; optional gitctx MCP enrichment (additive)
- Governance/feature status panel wired to local governance outputs
- Inspect/xray result surface with stable UI data contract
- One actionable follow-up from inspect output

Out of scope:

- Full Ask/Plan/Approve/Execute cockpit completion
- Platform control-plane modules (workspace registry, approval centre, org feature graph)
- Net-new backend engines where existing sidecar/crate capability already exists

## Requirements

- **FR-001**: OPC exposes an inspect entrypoint that executes an inspect flow for the current workspace and returns a deterministic result payload.
- **FR-002**: Git context panel renders live repository context from **native git** (branch/head, working tree cleanliness, repository path) and may show **additive** gitctx MCP enrichment (e.g. GitHub identity from `gitctx://context/current`) without replacing local git as authority.
- **FR-003**: Governance panel renders feature/governance status from compiled registry and featuregraph-backed outputs, with explicit handling for unavailable data.
- **FR-004**: Inspect surface renders xray/analysis outputs via a documented UI contract; error states are explicit and non-placeholder.
- **FR-005**: At least one actionable follow-up is available from inspect results (for example: open related feature spec, open governance details, or run a bounded follow-up command).
- **FR-006**: Removed placeholder behavior is replaced by real data paths or explicit temporary-degraded states with implementation notes.
- **FR-007**: No settled registry-consumer guarantees are altered by this feature.

## Contract notes

- UI wiring changes are governed product contracts for this slice and require fixture/snapshot or equivalent deterministic contract evidence where applicable.
- If any existing command/contract must be redefined, that work is a breaking change candidate and is not part of this MVP.

## Success criteria

- **SC-001**: A user can complete `Inspect -> understand state -> take one action` end to end without placeholder panels.
- **SC-002**: Git and governance panels are backed by real integrations, not stubs.
- **SC-003**: Inspect outputs and panel states are reviewable through deterministic test evidence.
- **SC-004**: Scope stays narrow: one vertical slice, no broad cockpit expansion.

## Delivery record *(non-normative)*

All tasks **T000–T013** are complete on `main` as of **2026-03-28**; see [`tasks.md`](./tasks.md) and [`execution/verification.md`](./execution/verification.md). Per Feature **003**, frontmatter **`status`** remains **`active`** (registry enum does not define a separate “implemented” value); completion is evidenced by tasks and verification artifacts.


## Security hardening amendment (2026-07-02)

Hardened the opc-web server. The /ws/claude WebSocket and all /api/* routes now sit behind the control-token middleware with a localhost Origin allowlist on the WebSocket upgrade; the default bind moved to 127.0.0.1 (a non-loopback bind is opt-in and requires a control token); the ungoverned skip-permissions bypass is refused on network-facing execute paths; CORS is restricted to localhost; the fs capability was narrowed off read-all, write-all, and scope-home-recursive to the specific commands and subtrees actually used; tool-derived URLs are scheme-validated before opening; and mutex poisoning is recovered instead of panicking.

Recorded during the cross-subsystem security-hardening sweep; couples the security fixes in the code paths this spec authors to their owning spec per the spec 127 coupling gate.
