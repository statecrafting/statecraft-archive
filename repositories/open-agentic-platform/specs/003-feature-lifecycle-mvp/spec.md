---
id: "003-feature-lifecycle-mvp"
title: "Feature lifecycle & status semantics (registry status model)"
feature_branch: "003-feature-lifecycle-mvp"
status: approved
implementation: complete
kind: platform
domain: substrate
created: "2026-03-22"
amended: "2026-06-18"
amendment_record: |
  amended 2026-06-18 by spec 217 (engine-swap collapse): the in-tree spec-compiler and registry-consumer that enforced the lifecycle status model were deleted; enforcement is now in spec-spine-core. The implementation code-units are stripped (paths deleted); the authored status-semantics model (draft/active/superseded/retired) remains this spec's contribution.
authors:
  - "open-agentic-platform"
language: en
summary: >
  Normative definitions and allowed transitions for feature status (draft, active,
  superseded, retired) in authored specs and compiled registry; consumer guarantees
  and explicit non-goals so 004+ can build on stable lifecycle language without
  reopening 000/001 unless a constitutional amendment is required.
# 217 deleted the in-tree spec-compiler + registry-consumer; the lifecycle status
# model (draft/active/superseded/retired) this spec defines is now enforced by
# spec-spine-core. The implementation code-units are stripped (paths deleted); the
# authored status-semantics model remains this spec's contribution. Amended by 217.
refines:
  - aspect: "status-semantics"
---

# Feature Specification: Feature lifecycle & status semantics

**Feature Branch**: `003-feature-lifecycle-mvp`  
**Created**: 2026-03-22  
**Status**: Draft  
**Input**: Feature **000** fixes the **`status`** enum in **`registry.schema.json`**; Feature **001** copies frontmatter into **`FeatureRecord.status`**; Feature **002** exposes **`--status`** filtering. This feature defines **what those values mean** and **how the project uses them**, so “usable truth” includes **interpretable lifecycle**, not just listing.

## Purpose and charter

Deliver **authoritative semantics** for the four registry **`status`** values and **recommended** lifecycle transitions for features in **`specs/<NNN>-<slug>/spec.md`**. Downstream tools (starting with **`registry-consumer`**) may **filter and display** by **`status`**; humans **set** **`status`** in frontmatter when a feature’s phase changes.

**Explicitly in scope (MVP):**

- Normative **definitions** of **`draft`**, **`active`**, **`superseded`**, **`retired`**
- **Recommended transition graph** (which moves are normal; which require extra narrative in the spec body)
- **Consumer guarantees**: what tools **may assume** when they see a given **`status`** in **`registry.json`**
- **Explicit non-goals** so scope does not drift into compiler enforcement or new JSON fields without a follow-up feature

**Explicitly out of scope (MVP):**

- **Amending** Feature **000** **`registry.schema.json`** (enum values are already fixed; new fields such as **`supersedes`** require a **separate** constitutional or registry-version feature)
- **New validation codes** in Feature **001** (e.g. rejecting “invalid” transitions)—unless a later feature explicitly adds lifecycle **enforcement**
- **Automated** status changes, bots rewriting frontmatter, or **task execution** (Feature **004+**)
- **Policy engines** or product runtimes (**axiomregent**, **xray**, **featuregraph**) as **required** consumers—this spec is **definitions + conventions** for humans and generic tools

## Normative dependency

- Subordinate to Feature **000** (enum set and **`FeatureRecord`** shape) and Feature **001** (compilation).
- Feature **002** remains the **reference consumer** for **`status`** filtering; this spec **does not** require **002** code changes for MVP beyond optional **documentation cross-links** (`plan.md`).

## Definitions *(mandatory)*

These definitions apply to **`features[].status`** in **`registry.json`** and to the **`status`** key in feature **`spec.md`** frontmatter.

| Value | Meaning |
|-------|---------|
| **`draft`** | The feature is **not yet** treated as stable platform commitment. Text may change freely; breaking edits are expected. Other features **should not** build hard dependencies on **`draft`** behavior unless explicitly coordinated in prose. |
| **`active`** | The feature is **current** platform truth for its scope: implementable, reviewable, and intended to stay coherent with the repo until superseded or retired. **Default target** for work that ships or gates other specs. |
| **`superseded`** | The feature is **no longer current**; another feature or document **replaces** it. The **`spec.md` body MUST name the replacement** (feature id, link, or clear pointer). The spec remains readable for history and traceability. |
| **`retired`** | The feature is **withdrawn** without a single named successor in the registry (experiment ended, scope abandoned, or subsumed without a 1:1 replacement). The **`spec.md` body SHOULD briefly state why** (one short section or paragraph). |

**`superseded` vs `retired`:** Use **`superseded`** when there is a **clear replacement** to follow. Use **`retired`** when there is **no** such pointer or the team intentionally leaves successor tracking to narrative only.

## Recommended transitions *(non-blocking for tooling)*

The following **directed** transitions are **recommended** for maintainers updating frontmatter. **Tooling MUST NOT** treat this table as enforced rules in Feature **003** MVP.

| From | To | Notes |
|------|-----|--------|
| **`draft`** | **`active`** | Feature ratified / implementation baseline agreed. |
| **`active`** | **`superseded`** | Add replacement pointer in body; consider linking from replacement spec. |
| **`active`** | **`retired`** | End-of-life without a single successor. |
| **`draft`** | **`retired`** | Withdrawn before ratification. |
| **`superseded`** | — | **Terminal** for logical “currentness”; further edits are editorial only. |
| **`retired`** | — | **Terminal** for logical “currentness”; further edits are editorial only. |

**Not recommended** (avoid without explicit team decision and prose justification):

- **`superseded`** or **`retired`** → **`active`** (re-opening a closed feature confuses history; prefer a **new** numbered feature that references the old id in text).
- Jumping **`draft`** → **`superseded`** without an **`active`** phase (possible in exceptional cases—document why in the spec).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: This spec’s **Definitions** and **Recommended transitions** sections are the **canonical** project reference for **`status`** semantics until amended by a later feature or Feature **000** ratification.
- **FR-002**: Feature **002** (or compatible consumers) **may** filter by **`status`** using the enum **without** additional interpretation; semantics for UX labels (e.g. “Deprecated”) are **derived from this spec**, not invented per tool.
- **FR-003**: Authors **must** set **`status`** in **`spec.md`** frontmatter to one of the four enum values; invalid values remain **Feature 001 / V-002** territory—**not** expanded here.
- **FR-004**: For **`superseded`**, the authoritative **`spec.md` must** contain a **replacement pointer** in the markdown body (see Definitions). No new machine field is required in Feature **003** MVP.
- **FR-005**: For **`retired`**, the **`spec.md` body should** include a **short rationale** (see Definitions). No new machine field is required in Feature **003** MVP.

### Key Entities

- **Lifecycle**: The combination of **`status`** + authoring conventions + (optional) narrative in **`spec.md`**.
- **Terminal statuses**: **`superseded`** and **`retired`** for “no longer current” work.

## Success Criteria *(mandatory)*

- **SC-001**: A new contributor can read this spec and **correctly classify** a feature’s phase and **choose** **`superseded`** vs **`retired`** without ambiguity in common cases.
- **SC-002**: Feature **002** **`--status`** filtering remains **valid** without code changes; documentation **links** this spec where **`status`** values are described (`plan.md` / README).

## Examples *(non-normative)*

Illustrative body excerpts only; real specs may be longer.

### `superseded` — replacement pointer

```markdown
## Supersession

This feature is superseded by **`005-new-registry-fields`**. Use that spec for
normative field definitions. This document remains for history only.
```

### `retired` — short rationale

```markdown
## Retirement

**Retired** (2026-03-22): The experimental API described here was not adopted.
No replacement feature; consumers should use the baseline described in
`specs/000-bootstrap-spec-system/spec.md` until a new feature addresses this area.
```

## Clarifications

_None yet._
