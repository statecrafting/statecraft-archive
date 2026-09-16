---
id: "004-spec-to-execution-bridge-mvp"
title: "Spec-to-execution bridge (changeset / task execution protocol)"
feature_branch: "004-spec-to-execution-bridge-mvp"
status: approved
implementation: complete
kind: platform
domain: substrate
created: "2026-03-22"
authors:
  - "open-agentic-platform"
language: en
summary: >
  Protocol for turning authored feature artifacts into executable work: execution
  unit (changeset), roles of spec/plan/tasks, task lifecycle separate from feature
  lifecycle, approval gates, verification, and on-disk markdown outputs—without
  orchestration runtime, registry schema expansion, or mandatory product bindings.
code_aliases:
  - TASK_RUNNER
establishes:
  - unit: { kind: crate, id: orchestrator }
---

# Feature Specification: Spec-to-execution bridge

**Feature Branch**: `004-spec-to-execution-bridge-mvp`  
**Created**: 2026-03-22  
**Status**: Draft  
**Input**: Features **000–003** establish constitution, compilation, consumption, and **feature** lifecycle. This feature defines how **planned work** for a feature is **represented** and **executed** as **authored markdown** (and optional human-approved steps), without collapsing governance into ad hoc agent behavior.

## Purpose and charter

Define a **spec-to-execution bridge**: a **protocol** and **artifact conventions** so that **intent** (spec), **strategy** (plan), and **trackable work** (tasks) stay aligned, and so **execution** produces **auditable outputs** on disk—**before** full automation, policy engines, or registry extensions.

**Explicitly in scope (MVP):**

1. **Execution unit** — canonical name, purpose, and tie to a **feature id**
2. **Roles of `spec.md` / `plan.md` / `tasks.md`** — normative division of responsibilities
3. **Task lifecycle** — states distinct from **feature** lifecycle (Feature **003**)
4. **Approval / safety gates** — where **human approval** is required before execution that could mutate the workspace or trigger external runners
5. **Verification contract** — what “done” means for a task or changeset
6. **Output artifacts** — categories of **markdown** (and optional referenced diffs) emitted under a predictable layout
7. **Non-goals** — boundaries so this feature does **not** become the orchestration runtime

**Explicitly out of scope (MVP):**

- **Automatic** frontmatter rewriting or compiler-enforced lifecycle (Feature **001** remains unchanged unless a later feature amends it)
- **Cross-feature dependency solving** or global scheduling
- **Feature 000** **`registry.json`** schema expansion for rich execution metadata
- **Mandatory** bindings to **axiomregent**, **xray**, **`agent.execute`**, or other product runtimes
- **Standalone authored YAML** outside markdown (Invariant **V-004**)

## Normative dependency

- Subordinate to Feature **000** (markdown authoring, compiler-owned JSON for registry only).
- **Feature lifecycle** (**003**) applies to **`spec.md`** frontmatter **`status`**; **task lifecycle** (this feature) applies to **tasks** and **execution** records—**orthogonal** dimensions.
- Execution metadata that might one day compile into JSON is **out of scope** for Feature **004** MVP unless a **future** feature extends the compiler.

## 1. Execution unit

The **canonical execution unit** is a **changeset**: a **single markdown document** that names the **scope of work** to be executed against a feature, ties execution to a **`feature id`**, and is **authored under that feature’s tree**.

**Normative path (MVP):** `specs/<NNN>-<slug>/execution/changeset.md`

- **Must** live under the same **`specs/<NNN>-<slug>/`** directory as the feature’s **`spec.md`**.
- **May** use YAML **frontmatter** inside the `.md` file (per Feature **000**); frontmatter **must not** duplicate large structured config—keep execution intent **reviewable in prose**.

**Minimum content expectations:**

- **Title** and **scope** (what this execution batch covers)
- **Reference** to **`spec.md`** / **`plan.md`** / **`tasks.md`** sections or task ids being executed
- **Feature id** in frontmatter as **`feature_id`** (string, matching **`spec.md`** `id`) **or** clear in the H1/body if frontmatter is minimal

**FR-001**: A **changeset** **must** be attributable to exactly **one** feature **`id`** (the owning **`specs/<NNN>-<slug>/`** directory).

**FR-002**: Multiple changesets over time **may** exist as separate files (e.g. `changeset.md`, `changeset-2.md`) or sequential sections—exact naming beyond `execution/changeset.md` is **implementation convention** documented in **`plan.md`**; MVP **requires** at least **`execution/changeset.md`** when execution is formally tracked.

## 2. Relationship: `spec.md`, `plan.md`, `tasks.md`

| Artifact | Role |
|----------|------|
| **`spec.md`** | **Normative intent** — what the platform **must** or **must not** do; acceptance criteria; scope boundaries. |
| **`plan.md`** | **Implementation strategy** — how implementers approach the work (stack, layout, risks); **subordinate** to **`spec.md`**. |
| **`tasks.md`** | **Executable breakdown** — discrete, checkable items and **progress surface**; **subordinate** to **`plan.md`** and **`spec.md`**. |

**FR-003**: If **`tasks.md`** conflicts with **`spec.md`**, **`spec.md`** wins. If **`plan.md`** conflicts with **`spec.md`**, **`spec.md`** wins.

**FR-004**: **`tasks.md`** **should** reference task ids (**T001**, **T002**, …) stably so **changeset** and **verification** can point to them.

## 3. Task lifecycle *(distinct from feature lifecycle)*

**Feature** **`status`** (**003**): `draft` \| `active` \| `superseded` \| `retired`.

**Task** **states** (execution progress on **`tasks.md`** items):

| State | Meaning |
|-------|---------|
| **`pending`** | Not started. |
| **`in_progress`** | Actively being worked. |
| **`blocked`** | Cannot proceed until an external dependency or decision clears. |
| **`complete`** | Done per **Verification contract** (below). |
| **`abandoned`** | Will not be done; **should** include a one-line reason in **`tasks.md`** or linked note. |

**FR-005**: Task state **must** be representable in **markdown** (checkbox + label, table column, or explicit tag—convention fixed in **`plan.md`**). **No** registry field is required for task state in Feature **004** MVP.

**FR-006**: Tools and humans **must not** conflate **feature** **`status`** with **task** state (e.g. “feature **active**” does not imply all tasks **complete**).

## 4. Approval / safety gates

**FR-007**: **Execution** that can **mutate the repository** (writes outside narrowly scoped automation) **requires** an explicit **approval** step recorded in **markdown**: either a section in **`execution/changeset.md`** (e.g. **Approved by:** name/date) or a project-defined workflow that leaves an **audit trail** in prose.

**FR-008**: **Execution** that invokes **external** runners (CI, remote agents, destructive scripts) **must** be **called out** in the **changeset** with **what** runs and **under what preconditions**; blind “run everything” blocks are **out of compliance** with this spec.

**FR-009**: MVP does **not** define machine-readable signatures; **human-readable** approval text is sufficient.

## 5. Verification contract

“**Done**” for a **task** or **changeset** **must** be **demonstrable** from repository state and/or **verification** notes.

**Minimum expectations (pick applicable per task; document in `tasks.md` or changeset):**

- **Tests pass** (commands stated or CI link referenced in prose)
- **Required files** created/updated as named in **spec** or **task**
- **Task state** moved to **`complete`** (or **`abandoned`** with reason)
- **Verification** subsection or **`execution/verification.md`** summarizing what was checked

**FR-010**: A task marked **`complete`** **must** have **traceable** evidence (file path, test command, or explicit “N/A” justification for non-code tasks).

**FR-011**: A **changeset** is **verified** when all **in-scope** tasks it claims are **`complete`** or **`abandoned`**, and a **short verification summary** exists per **FR-010**.

## 6. Output artifacts

All **durable** execution outputs in Feature **004** MVP are **markdown** (or **diffs referenced from markdown**), under the **feature** tree unless Feature **000** is amended later.

**Recommended layout:**

| Path | Role |
|------|------|
| **`specs/<id>/execution/changeset.md`** | Execution unit / scope / approvals |
| **`specs/<id>/execution/verification.md`** | Optional consolidated verification log |
| **`tasks.md`** | Checkbox/task state updates |

**FR-012**: **No** new **compiler-emitted JSON** execution registry is introduced in Feature **004** MVP.

**FR-013**: Optional **patches** or **PR links** **may** be cited in **`verification.md`** or task notes; they are **not** required to be machine-parsed.

## 7. Non-goals *(orchestration boundary)*

- **Not** a full **orchestration engine**, scheduler, or agent loop specification.
- **Not** replacing **Feature 001** validation or **Feature 002** read APIs.
- **Not** defining **005**-level reconciliation or policy—those are **later** slices.

## Success Criteria *(mandatory)*

- **SC-001**: A contributor can open **`specs/<id>/`** and understand **intent** vs **plan** vs **tasks** vs **execution** without conflicting definitions.
- **SC-002**: **Task** states are **usable** without new tooling; optional tools **may** parse **`tasks.md`** later.
- **SC-003**: **Approval** and **verification** expectations are **clear enough** for a code review to reject “silent” execution.

## Clarifications

_None yet._
