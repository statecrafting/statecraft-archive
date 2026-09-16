---
id: "006-conformance-lint-mvp"
title: "Conformance lint (optional workflow warnings)"
feature_branch: "006-conformance-lint-mvp"
status: superseded
superseded_by: "217-spec-spine-engine-swap-collapse"
implementation: complete
amended: "2026-05-13"
amendment_record: "147-spec-kind-grammar"
kind: platform
domain: tooling
created: "2026-03-22"
authors:
  - "open-agentic-platform"
language: en
summary: >
  Non-blocking conformance checks for the 003–005 authored protocol: warning codes,
  heuristics for lifecycle and execution hygiene, and a spec-lint tool that never
  substitutes for Feature 001 structural validation or registry truth.
  Amended by spec 128 (2026-05-02) to ratify the `--fail-on-warn` strict posture
  for OAP's CI invocation.
  Amended by spec 147 (2026-05-13) to register W-130/W-131/W-132 against the new
  kind-grammar surface and to add a registration-site `severity` field on Warning
  (warning/info tiers) per spec 128 §7. Info-tier diagnostics emit alongside
  warning-tier but are exempt from `--fail-on-warn`.
origin:
  retroactive: true
---

# Feature Specification: Conformance lint

**Feature Branch**: `006-conformance-lint-mvp`  
**Created**: 2026-03-22  
**Status**: Draft  
**Input**: Features **003–005** define **lifecycle**, **execution**, and **verification**. This feature adds **optional**, **non-blocking** **warnings** so humans and CI can notice **protocol drift** before it becomes silent failure.

> **Amendment 2026-05-02 (record: 128-spec-lint-default-fail-on-warn).**
> The "advisory unless a repo policy opts into `--fail-on-warn`" clause
> in §"Normative dependency" is now activated for OAP: `make ci-tools`
> invokes `spec-lint --fail-on-warn` and propagates non-zero exits. The
> CLI default (exit 0 on warnings) is unchanged; this is a per-repo
> integration choice. See `specs/128-spec-lint-default-fail-on-warn/`
> for the policy rationale.

## Purpose and charter

Provide **lint semantics** and a **reference implementation** (`spec-lint`) that emit **warnings**—**not** errors that invalidate the **registry** or **compile** pipeline.

**Explicitly in scope (MVP):**

- **Warning catalog** with stable **`W-xxx`** codes
- **Heuristic checks** aligned with **003–005** (documented limitations: **false positives/negatives** possible)
- **CLI** that prints warnings to **stderr** and exits **0** by default when the lint **run** (no crash) completes
- **Optional** `--fail-on-warn` (or equivalent) for **strict** CI

**Explicitly out of scope (MVP):**

- **New** Feature **001** validation codes (**V-xxx**) or **compiler** integration
- **Changing** **`registry.json`** shape or **`validation.passed`** semantics
- **Mandatory** product hooks (**axiomregent**, **xray**, agents)
- **Guaranteed** completeness of heuristics (markdown is ambiguous; **005** remains normative for human reconciliation)

## Normative dependency

- **Feature 001** remains the **sole** gate for **structural** spec/registry validity.
- **006** warnings are **advisory** unless a repo policy opts into **`--fail-on-warn`**.

## Warning codes *(MVP catalog)*

| Code | Condition (heuristic summary) |
|------|-------------------------------|
| **W-001** | **`tasks.md`**: a **checked** line contains **`(complete)`** (explicit **004** tag); **`execution/verification.md`** **missing**. **Does not** treat every **`- [x]`** as requiring verification—only this tagged convention triggers **W-001** in MVP. |
| **W-002** | **`spec.md`**: frontmatter **`status: superseded`** but body lacks a plausible **replacement pointer** (see **003**). |
| **W-003** | **`spec.md`**: frontmatter **`status: retired`** but body lacks a plausible **rationale** snippet. |
| **W-004** | **`execution/changeset.md`** exists (non-example heuristic) but **`execution/verification.md`** is **missing**. |
| **W-005** | **`tasks.md`**: **both** **`(pending)`** and a **`###`** heading present (one **known** mixed-pattern heuristic—not a full detector for all notation pairs). |
| **W-006** | *Reserved* — task-id orphan detection; **not** implemented in the reference **`spec-lint`** MVP (too noisy without richer parsing). |

**FR-001**: The **reference implementation** **must** document exact regex/heuristics in **`tools/spec-spine/spec-lint/README.md`** and keep them **versioned** with **`spec-lint`** releases.

**FR-002**: **Warnings** **must** include **`W-xxx`**, **path**, and **short message** on **stderr** (or stdout—pick one and document; default **stderr**).

**FR-003**: **Default exit code** after a successful lint run is **0** even when warnings **> 0**. **`--fail-on-warn`** **may** yield **non-zero** if warnings **> 0** (document exact code in **`plan.md`**).

## Heuristic details *(non-exhaustive)*

- **W-002** replacement pointer: body matches (case-insensitive) at least one of: `superseded by`, `` `NNN-` `` pattern, `## supersession`, `replacement feature`.
- **W-003** rationale: body matches (case-insensitive) at least one of: `## retirement`, `**retired**`, `rationale`, `withdrawn`.
- **W-004** example skip: if **`changeset.md`** matches `(?i)(example|illustrates|non-normative template)` in the first **4 KiB**, **suppress** **W-004** for that feature.
- **W-001**: only lines with **`- [x]`** and substring **`(complete)`** (case-insensitive on the tag); plain **`- [x]`** without **`(complete)`** does **not** trigger **W-001**.
- **W-005**: file contains **`(pending)`** and **`###`** (any ATX heading line); not a general mixed-notation solver.

## Success Criteria *(mandatory)*

- **SC-001**: Running **`spec-lint`** on this repository completes without panic and lists **0+** warnings deterministically for the same tree.
- **SC-002**: **001** **`compile`** behavior is **unchanged** by **006** (no coupling).
- **SC-003**: Contributors can look up **`W-xxx`** meaning in this spec.

## Clarifications

### Session 2026-03-22

- **W-001** / **W-005** heuristics are **intentionally narrow**; see **`tools/spec-spine/spec-lint/README.md`** “Scope limits (MVP).” Broader rules wait for real-world pain and a later **spec-lint** / spec revision.
