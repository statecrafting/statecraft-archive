---
id: "002-registry-consumer-mvp"
title: "Registry consumer MVP (read-only spec runtime surface)"
feature_branch: "002-registry-consumer-mvp"
status: superseded
superseded_by: "217-spec-spine-engine-swap-collapse"
implementation: complete
kind: platform
domain: tooling
created: "2026-03-22"
authors:
  - "open-agentic-platform"
language: en
summary: >
  Define the first official read-only consumer of .derived/spec-registry/registry.json:
  who may read it, what guarantees downstream tools rely on, and a normative CLI for
  listing, filtering, and lookups; optional Rust library is non-normative for MVP.
# 217 (spec-spine engine swap) deleted the in-tree registry-consumer crate
# (open_agentic_spec_registry_reader) this spec established; all establishes units
# are removed because those paths no longer exist. The read-only registry surface
# is now spec-spine registry (list/show/status-report) + oap-registry-enrich
# (authority verbs). Superseded by 217, together with the 007-031 contract series.
# Historical authorship preserved in 217's supersedes edge and this spec's prose.
---

# Feature Specification: Registry consumer MVP

**Feature Branch**: `002-registry-consumer-mvp`  
**Created**: 2026-03-22  
**Status**: Draft  
**Input**: After Feature **001**, compiled feature state exists as **`registry.json`**, but no normative **consumer** has been specified. This feature defines the **first read surface** over that artifact.

## Purpose and charter

This feature specifies **who reads** **`.derived/spec-registry/registry.json`**, **what they may assume**, and **what behavior is stable** for downstream tooling—at MVP scope, **read-only** (no mutation of specs, no orchestration, no new machine-truth formats).

It implements the missing layer: **compiled truth → usable truth** for humans and automation that need to **navigate** feature specs without parsing markdown.

**Explicitly in scope (MVP):**

- A **canonical first consumer** implemented as a **required CLI** (see **FR-001**) with **read-only** semantics
- **Listing**, **filtering**, and **lookups** over **`features[]`** using fields defined by Feature **000**’s registry schema (via Feature **001** emission)
- Documented **guarantees** and **non-guarantees** for downstream tools (CLI, scripts, future UI)
- Clear **out-of-scope** boundaries so later features (lifecycle semantics, execution bridges, policy, product runtimes) can attach without collapsing back into compiler work

**Explicitly out of scope:**

- Changes to Feature **000** JSON Schemas or Feature **001** compiler contracts **unless** this spec proves a minimal amendment is unavoidable (default: **avoid**; file a follow-up amendment spec instead of smuggling scope into 002)
- **Compiler** behavior, new **validation codes**, parsers, frontmatter rules, or “schema elegance” refactors
- **Mutation** of authored specs or **writing** alternate registries by hand
- **Orchestration**, **task execution**, **policy enforcement** beyond reading compiled state (see roadmap in platform docs—**003+**)
- **axiomregent**, **xray**, **featuregraph**, or other product runtimes as **required** dependencies of the MVP (they may **consume** the same JSON later)

## Normative dependency

- Feature **002** is **subordinate** to Feature **000** (contracts) and **assumes** Feature **001** (compiler emits valid **`registry.json`** per **`registry.schema.json`**).
- If this spec’s text conflicts with Feature **000**, **Feature 000 wins**.
- Feature **001** remains the **compile gate**: consumers **read** compiler output; they do **not** replace compilation.

## Architectural placement

| Layer | Role |
|--------|------|
| **000** | Constitution: authored truth vs machine truth |
| **001** | Compiler baseline: emit **`registry.json`** / **`build-meta.json`**, validate |
| **002** | **Read surface**: stable, documented consumption of **`registry.json`** (MVP: read-only) |
| **003+** | Platform capabilities (lifecycle, execution bridge, governance, runtimes) |

## User Scenarios & Testing *(mandatory)*

### User Story 1 — List features for scripts and contributors (Priority: P1)

A contributor or CI job needs a **stable list** of feature **id**s, **title**s, and **status** values from the **last successful compile**, without parsing `specs/` trees ad hoc.

**Why this priority:** Without a defined consumer, **`registry.json`** is an orphan artifact.

**Independent Test:** Run the canonical consumer against a repo with a fresh **`registry.json`**; compare output to known fixtures.

**Acceptance Scenarios**:

1. **Given** `validation.passed` is **true** in **`registry.json`**, **When** the consumer lists features, **Then** every **`features[]`** entry is reachable and fields match the Feature **000** schema for **`featureRecord`**.
2. **Given** optional filters by **status** and **`id` prefix** (prefix only—no substring match in MVP), **When** the user applies them, **Then** only matching rows are returned (deterministic ordering documented in `plan.md`).

---

### User Story 2 — Resolve a feature by id (Priority: P1)

A tool resolves **`002-registry-consumer-mvp`** (or any **`NNN-kebab`**) to **title**, **specPath**, and **sectionHeadings** for navigation or doc generation.

**Why this priority:** Downstream tools need **addressability** without duplicating registry logic.

**Acceptance Scenarios**:

1. **Given** a valid feature **id** present in **`features[]`**, **When** the consumer runs **`show`**, **Then** it emits the **full** matching **`featureRecord`** as **JSON** on stdout (the Feature **000** object shape—no separate “presentation subset” contract in MVP).
2. **Given** an **id** not present in **`features[]`**, **When** the consumer runs **`show`**, **Then** it exits with **code 1** and does not print a successful record (see **Exit codes**).

---

### User Story 3 — Unsafe / stale registry handling (Priority: P2)

Automation may run against a **stale** file or a failed compile output where **`validation.passed`** is **false**.

**Why this priority:** Prevents silent misuse of invalid compiled state.

**Acceptance Scenarios**:

1. **Given** **`validation.passed`** is **false**, **When** the consumer runs in **default** mode, **Then** it **refuses** to treat the registry as authoritative (exit code **1** unless **`--allow-invalid`** is set for diagnostics).
2. **Given** **`validation.passed`** is **true**, **When** the consumer runs, **Then** it proceeds without that warning path.

---

### Edge Cases

- **Missing file**: Clear error; exit code **3** (I/O / unreadable input).
- **Schema version**: Consumer targets **`specVersion`** in **`registry.json`** as defined by Feature **000**; if **`specVersion`** bumps in a future constitutional change, consumer behavior is **defined in this spec or an amendment** (MVP pins to current **`specVersion`** line).
- **Empty `features[]`**: Valid per Feature **001**; list/lookup return empty / not-found as appropriate.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The **canonical MVP consumer** MUST be a **CLI** (binary name and path in **`plan.md`**—default **`tools/spec-spine/registry-consumer/`**, binary **`registry-consumer`**). A **Rust library** inside the same crate for parse/query helpers is **optional** and **non-normative** for Feature **002** MVP (implementations MUST NOT treat a public library API as required for conformance).
- **FR-002**: Read **`registry.json`** only from the path **`.derived/spec-registry/registry.json`** relative to repository root by default; optional **`--registry-path`** override for tests and advanced use (documented).
- **FR-003**: Support **`list`** and **`show <feature-id>`**; support **filtering** on **`list`** by **`--status`** and **`--id-prefix`** (**prefix match on `id` only**—no substring / contains matching in MVP).
- **FR-004**: **Default** mode MUST **reject** using the registry as authoritative when **`validation.passed`** is **false**, per User Story 3 (exact policy in `plan.md`).
- **FR-005**: Document **stable sort order** for **list** output (e.g. lexicographic by **`id`**, matching Feature **001** determinism expectations).
- **FR-006**: **`show`**: On success, emit **one JSON object** on stdout: the **full** **`featureRecord`** for the given **`id`** (the object defined under **`features[]`** in Feature **000**’s registry contract). No separate trimmed or alternate “view model” in MVP.
- **FR-007**: **`list`**: Default output MUST be **human-readable** text (e.g. table or aligned columns—exact layout in **`plan.md`** / README). **Machine-oriented JSON output** for **`list`** is **out of scope** for MVP unless added in a later feature.
- **FR-008**: Consumer MUST **not** write to **`specs/`**, **`build/`** (except optional stdout/stderr), or introduce new persistent machine-truth files in MVP.
- **FR-009**: Downstream **guarantees** MUST be documented: **`featureRecord`** fields follow Feature **000** as emitted by Feature **001** (no parallel presentation schema for **`show`** beyond that object).
- **FR-010 (trust model)**: The consumer **trusts** that **`registry.json`** is **compiler-emitted** with structure compatible with parsing as the top-level registry object; it MUST read and enforce **`validation.passed`** before authoritative use (unless **`--allow-invalid`**). It MUST **not** run **Feature 000 JSON Schema** validation **by default**—Feature **001** remains the **sole** schema gate; the consumer is **not** a second validator.

### Exit codes *(normative for CLI)*

Aligned with Feature **001** style (`0` / `1` / `3`):

| Code | Meaning |
|------|---------|
| **0** | Success (command completed; **`show`** found the feature; **`list`** completed). |
| **1** | **`show`**: feature **id** not found (including when **`features[]`** is empty). **Or** any command: registry refused because **`validation.passed`** is **false** and **`--allow-invalid`** was not set. |
| **3** | I/O failure (missing/unreadable **`registry.json`**), JSON parse failure, or other **runtime** failure reading/parsing the file. |

### Key Entities

- **Registry consumer**: The **CLI** implementing this spec (path/name in `plan.md`). Optional internal library code is implementation detail.
- **Authoritative registry**: A **`registry.json`** that **parses** as the expected structure and has **`validation.passed`** **true** (per **FR-010**, no default re-validation against **`registry.schema.json`** in the consumer).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new contributor can **list** and **look up** features using documented commands in under **15 minutes** on a clean clone (after **`registry.json`** exists—typically after running Feature **001** compile).
- **SC-002**: Behavior for **`validation.passed: false`** is **observable** and **safe-by-default** (no silent success).
- **SC-003**: Automated tests cover **list**, **`show`** (full **featureRecord** JSON), **invalid-registry** refusal, and **exit codes** **0** / **1** / **3** per this spec (exact test style in `plan.md`).
- **SC-004**: No change to **`standards/schemas/spec-spine/*.schema.json`** is required for MVP **unless** an explicit amendment note is added to this spec (default: **zero** contract diffs).

## Clarifications

### Session 2026-03-22

- **Canonical surface**: CLI required for MVP; optional Rust library is **non-normative**.
- **`show`**: Full **`featureRecord`** JSON on stdout; no parallel presentation contract.
- **Filters**: **`--id-prefix`** is **prefix-only** (no substring match).
- **Exit codes**: **0** / **1** / **3** fixed as in **Exit codes** table.
- **Trust model**: Parse JSON + enforce **`validation.passed`**; **no** default **`registry.schema.json`** re-validation in the consumer.
- **`list`**: Human-readable default; **JSON list output** deferred past MVP.
