---
id: "005-verification-reconciliation-mvp"
title: "Verification and reconciliation (repository state)"
feature_branch: "005-verification-reconciliation-mvp"
status: approved
implementation: complete
kind: platform
domain: substrate
created: "2026-03-22"
authors:
  - "open-agentic-platform"
language: en
summary: >
  How execution claims are checked against the repo: verifiable evidence, reconciling
  tasks and changesets to files, commands, tests, and scope; verification states;
  drift handling; minimum markdown verification artifact—without compiler enforcement,
  CI prescriptions, or policy/runtime coupling.
code_aliases:
  - VERIFICATION_SKILLS
  - VERIFY_PROTOCOL
refines:
  - aspect: "verification-protocol"
    unit: { kind: crate, id: orchestrator }
---

# Feature Specification: Verification and reconciliation

**Feature Branch**: `005-verification-reconciliation-mvp`  
**Created**: 2026-03-22  
**Status**: Draft  
**Input**: Feature **004** defines **how** work is represented (`changeset`, tasks, approval). This feature defines **how claims of completion are checked** against **repository state** and **stated scope**, and **what to do when reality diverges** from the record—without turning into an orchestrator or extending **`registry.json`**.

## Purpose and charter

Provide a **verification and reconciliation model**: **evidence**, **states**, **drift**, and a **minimum verification artifact** so humans and tools can answer: *Does this changeset’s story match what the repo actually contains?*

**Explicitly in scope (MVP):**

1. **Verifiable evidence** — categories that count toward “done”
2. **Reconciliation** — mapping **task** / **changeset** claims to **files**, **commands**, **tests/results**, and **declared scope**
3. **Changeset verification states** — **verified**, **partially verified**, **failed**, **stale**
4. **Drift** — mismatches (missing evidence, out-of-scope edits, misaligned specs)
5. **Minimum `verification.md` format** — markdown-first, optional YAML frontmatter inside `.md`

**Explicitly out of scope (MVP):**

- **Feature 001** compiler changes, new **V-*** codes, or automatic blocking of merges
- **Prescriptive CI** configuration (which workflow file, which runner)—**005** may **reference** that verification *happened* in prose, not mandate pipeline shape
- **Policy engines**, **axiomregent**, **xray**, or mandatory **agent** hooks
- **Cross-repo or cross-feature dependency resolution**
- **Machine-readable execution metadata** in **`registry.json`** (deferred to a **007**-style feature if needed)

## Normative dependency

- Subordinate to Feature **000** (markdown authoring; compiler JSON for registry only).
- **004** defines **changeset** and **verification contract** at a high level; **005** **refines** what **verification** means and how to **record** outcomes.
- **003** **feature** lifecycle remains orthogonal to **verification state** of a **changeset**.

## 1. Verifiable evidence

Evidence is **anything reviewable** that ties a **claim** to **observable fact**. MVP categories:

| Category | Examples (non-exhaustive) |
|----------|---------------------------|
| **Files** | Paths listed as created/changed; links to commits or PRs in prose |
| **Commands** | Shell commands with **expected** outcome (e.g. test command + exit **0**) recorded in **`verification.md` or `tasks.md`** |
| **Tests / results** | Failing→passing narrative; CI job name + run link; local **`cargo test`** transcript summary |
| **Scope alignment** | Explicit list of **in-scope** paths or task ids in **`changeset.md`** echoed in verification |

**FR-001**: A task or changeset marked **complete** per **004** **must** cite **at least one** evidence category unless **explicitly justified** as **N/A** (docs-only, process-only) in **`verification.md`**.

**FR-002**: **Evidence** **must** be **human-reviewable** in **markdown**; binary blobs are **out of scope** for **005** MVP except as **external links**.

## 2. Reconciliation dimensions

**Reconciliation** is the act of comparing **claims** (tasks, changeset scope) to **facts** (tree, history, test output).

### 2.1 Files changed

- **Claim**: paths or globs in **`changeset.md`** or **tasks**.
- **Check**: those paths exist / differ as described; **unexpected** paths may indicate **scope drift** (see §4).

### 2.2 Commands run

- **Claim**: command(s) recorded as run for verification.
- **Check**: rerunnable where safe; otherwise **attested** (e.g. CI URL) in **`verification.md`**.

### 2.3 Tests and results

- **Claim**: tests relevant to the feature **pass** or **baseline** documented.
- **Check**: link or command + **result** summary; **flaky** tests **should** be called out in prose.

### 2.4 Stated scope

- **Claim**: **changeset** scope section matches **tasks** included.
- **Check**: no **orphan** tasks marked **complete** without mapping to scope; no **silent** expansion of scope without **changeset** update.

**FR-003**: Reconciliation **may** be **manual** (review) or **tool-assisted** (future); **005** defines **what to compare**, not **automation**.

## 3. Changeset verification states

Normative states for a **changeset** (as recorded in **`execution/verification.md`** or equivalent):

| State | Meaning |
|-------|---------|
| **Verified** | All **in-scope** tasks for this changeset are **complete** or **abandoned** with reason; **evidence** recorded; **no unresolved** drift for this batch. |
| **Partially verified** | Some tasks **complete** with evidence; others **pending**, **blocked**, or evidence **incomplete**; or **scope** partially satisfied. |
| **Failed** | **Explicit** check failed (tests fail, required file missing, scope violated) **or** evidence shows **cannot** meet intent without **new** spec work. |
| **Stale** | Record was **true** when written, but **repository** or **upstream spec/plan/tasks** **changed** such that the verification record **no longer** reflects current truth **without** a fresh pass. |

**FR-004**: Exactly **one** of these labels **must** appear as the **current** verification outcome for an active **changeset** review (typically in **`verification.md` frontmatter** as **`verification_status`** or an **H2** heading—convention in **`plan.md`**).

**FR-005**: **Stale** **must** be used when **`spec.md`**, **`plan.md`**, or **`tasks.md`** **materially** change after verification was recorded, until **re-verified**.

## 4. Drift

### 4.1 Task complete, evidence missing

- **Symptom**: **`complete`** in **`tasks.md`** but no corresponding **evidence** in **`verification.md`** or task note.
- **Response**: Treat as **not verified** until evidence is added **or** task is moved to **`abandoned`** / **`in_progress`** with explanation.

### 4.2 Files changed outside declared scope

- **Symptom**: Diff touches paths not listed in **changeset** scope.
- **Response**: **Failed** or **partially verified** until **changeset** is updated to include those paths **or** changes are reverted; **may not** be **verified** while scope and reality disagree.

### 4.3 `spec` / `plan` / `tasks` no longer align

- **Symptom**: **tasks** reference removed **FR**s; **plan** describes code layout contradicted by **spec**.
- **Response**: **Stale** at minimum; fix **documents** before claiming **verified**.

**FR-006**: Drift **must not** be **silent**—**`verification.md`** (or **`changeset.md`**) **should** record **known** gaps in a **Drift** or **Open issues** subsection when **partially verified**.

## 5. Minimum verification artifact

**Normative path:** `specs/<NNN>-<slug>/execution/verification.md`

**Minimum sections (headings may vary; content required):**

1. **Context** — **feature id**, **changeset** reference (link or path), **date**
2. **Evidence** — bullets for **files**, **commands**, **tests/results** as applicable
3. **Outcome** — one of: **Verified** \| **Partially verified** \| **Failed** \| **Stale**
4. **Reconciliation notes** — how scope was checked; **N/A** justifications if any

**Optional YAML frontmatter** (inside `.md`): **`feature_id`**, **`verification_status`**, **`changeset_ref`**, **`verified_at`** (ISO date).

**FR-007**: **`verification.md`** **must** be **markdown**; **no** standalone **`.yaml`** evidence files (Invariant **V-004**).

## Success Criteria *(mandatory)*

- **SC-001**: A reviewer can classify a changeset as **verified** / **partially verified** / **failed** / **stale** using **005** without ad hoc definitions.
- **SC-002**: **Drift** cases in §4 have **prescribed responses** that do not require new tooling.
- **SC-003**: **Minimum artifact** is **small enough** to author by hand for a typical feature batch.

## Clarifications

_None yet._
