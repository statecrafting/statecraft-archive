---
id: "088-factory-upstream-sync"
slug: factory-upstream-sync
title: Factory Upstream Sync Protocol
status: superseded
superseded_by: "108-factory-as-platform-feature"
implementation: complete
owner: bart
created: "2026-04-10"
kind: process
domain: platform
summary: >
  Defines the protocol, mapping manifest, and tooling for translating updates
  from upstream repositories (legacy-factory, template) into OAP's
  factory/ three-layer architecture. Superseded by spec 108: the translation
  protocol in §5 is retained and lifted into the spec 108 sync worker, but
  storage moves from the on-disk factory/ tree to PostgreSQL and the trigger
  moves from the /factory-sync CLI command to the statecraft UI.
depends_on:
  - "074-factory-ingestion"  # factory-ingestion
  - "075-factory-workflow-engine"  # factory-workflow-engine
---

# 088 — Factory Upstream Sync Protocol

## 1. Problem Statement

OAP's `factory/` directory is derived from two upstream sources maintained in
the Statecraft-ing GitHub organization:

- **legacy-factory** (`legacy-factory`,
  `statecrafting/legacy-factory`) — the upstream production factory
  containing pipeline orchestration skills, controller agents, page type
  definitions, security assessment agents, and an evaluation framework.
  Historically tracked as `the_factory`.
- **template** (`template`, `statecrafting/template`) —
  the upstream enterprise application scaffold that the `acme-vue-node` adapter
  targets.

Both upstreams continue to evolve independently. When bugs are discovered during
real pipeline runs, fixes land in the upstream repos first (where the runs
happen), then must be translated into OAP's factory architecture. Today this
translation is reactive and manual — someone notices a pipeline failure, traces
it to an upstream fix, and manually ports the change. This process is error-prone
and creates a growing drift between upstream and OAP.

The problem is compounded by **structural divergence**: legacy-factory
uses a flat skill-file organization (`Factory Agent/Controllers/api-builder.md`
at 55KB), while OAP uses a three-layer architecture (`process/stages/`,
`contract/schemas/`, `adapters/{name}/patterns/`). A single upstream file often
maps to 3-5 OAP files across different layers. Simple file copying or git
subtree merges do not work.

## 2. Design Principles

1. **Translation, not copying.** Upstream changes are translated through the
   mapping manifest into OAP's architecture. The manifest declares which
   upstream files map to which OAP targets, and whether the relationship is
   `diffable` (structurally similar, can be diffed) or `restructured` (requires
   human judgment to translate).

2. **Upstream-agnostic protocol.** The same process handles legacy-factory,
   template, and any future upstream. Each upstream is a named entry in the
   mapping manifest with its own path, SHA tracking, and mappings.

3. **Client-specific content is filtered.** Client-specific content
   (internal references, IdP-vendor specifics, internal classifications,
   client document generation) is excluded during translation. The mapping
   manifest declares what to strip.

4. **SHA-tracked sync points.** Each upstream's last-synced commit SHA is
   recorded. The sync process diffs from that SHA to the upstream HEAD,
   identifies affected OAP targets via the manifest, and produces a structured
   change report.

5. **Human-in-the-loop for restructured mappings.** When a mapping is marked
   `restructured`, the sync process produces a change report and pauses for
   human review rather than attempting automatic translation.

## 3. Mapping Manifest

The mapping manifest lives at `factory/upstream-map.yaml`. It declares:

### 3.1 Schema

```yaml
schema_version: "1.0.0"

upstreams:
  {upstream-name}:
    path: "{local-path}"                  # absolute or ~ path
    remote: "{org/repo}"                  # optional GitHub remote
    last_synced_sha: "{sha}"              # updated after successful sync
    last_synced_date: "{ISO date}"        # human reference

    exclude_patterns:                     # files to never sync
      - "pattern"

    mappings:
      - source: "{upstream-relative-path}"
        targets:
          - "{oap-factory-relative-path}"
        relationship: "diffable | restructured | extract-only"
        layer: "process | contract | adapter"
        notes: "{translation guidance}"
```

### 3.2 Relationship Types

| Type | Meaning | Sync Behavior |
|---|---|---|
| `diffable` | Structurally similar, can be meaningfully diffed | Show side-by-side diff, propose edits |
| `restructured` | Fundamentally different structure, same domain | Show upstream changes, identify affected OAP sections, require human judgment |
| `extract-only` | Only specific sections of the upstream file are relevant | Extract named sections, ignore the rest |

### 3.3 Layer Assignment

Each mapping declares which OAP layer its targets belong to. This determines
how changes propagate:

- **process** — Stage definitions and process-layer agents. Changes here affect
  all adapters. Translate with care.
- **contract** — Schemas and verification checks. Changes here may require
  corresponding updates to process and adapter layers.
- **adapter** — Adapter-specific patterns, agents, invariants. Changes here are
  scoped to one adapter.

## 4. Sync Protocol

The `/factory-sync` command implements this protocol:

### Phase 1: Discover Changes

1. For each upstream in the manifest:
   a. Verify the upstream path exists
   b. Diff from `last_synced_sha` to upstream HEAD
   c. For each changed file, look up mappings in the manifest
   d. Partition changes into: `mapped` (has OAP targets), `unmapped` (no
      manifest entry), and `excluded` (matches exclude_patterns)

2. Produce a **Change Report** written to `.factory/sync-report.md`:
   - Per-upstream section with commit range, date range, summary
   - Per-file section with: upstream file, change summary, affected OAP targets,
     relationship type, translation difficulty
   - Unmapped files section (may indicate the manifest needs updating)

### Phase 2: Analyze Impact

For each mapped change:

1. Read both the upstream diff and the current OAP target file(s)
2. Classify the change:
   - **Bug fix** — fixes a defect found during pipeline runs. Highest priority.
   - **Enhancement** — adds new capability or strengthens validation.
   - **Refactor** — restructures without changing behavior.
   - **Client-specific** — upstream-specific content that should not be translated.
3. For `diffable` relationships: generate a proposed edit for each OAP target
4. For `restructured` relationships: describe what changed and which OAP
   sections are likely affected
5. For `extract-only` relationships: extract the relevant sections and compare

### Phase 3: Apply (with checkpoints)

1. Present the change report to the user
2. **Checkpoint: wait for user approval before applying any changes**
3. For approved changes, apply edits to OAP targets
4. After each file is modified, verify it maintains internal consistency:
   - Gate IDs referenced in stage files match verification schema definitions
   - Pattern file references match manifest entries
   - Invariant IDs follow the sequence without gaps
5. **Checkpoint: present modified files for review before updating the SHA**
6. On approval, update `last_synced_sha` and `last_synced_date` in the manifest

### Phase 4: Verify

1. Run the spec compiler to verify no spec regressions
2. If the Rust factory-engine crate exists, verify it compiles
3. Report a summary: changes applied, files modified, SHA updated

## 5. Exclusion Rules

Content that is never translated from legacy-factory:

| Category | Examples | Reason |
|---|---|---|
| Org-specific references | Department names, program codes | Client-specific |
| IdP-specific auth | Entra ID group claims, SAML assertions | Vendor-specific |
| Client document generation | docx-generator.py, ppt-generator.py | Client deliverable format |
| Restricted classification | Threat models, internal sensitivity levels | Client security classification |
| Evaluation framework | eval_framework/, REDTEAM/ | Separate concern, Python-based |
| Client web standards | api-web-standards.md, api-standards-compliance.md | Client policy documents |

Content that is never translated from template:

| Category | Examples | Reason |
|---|---|---|
| Template orchestration | .claude/orchestration/ | Template-internal, superseded by factory adapter |
| Application source code | apps/, packages/, scripts/ | The scaffold itself, not the adapter |
| Node modules / lockfiles | node_modules/, package-lock.json | Build artifacts |

## 6. Functional Requirements

- **FR-001**: The mapping manifest MUST be the single source of truth for
  upstream-to-OAP file correspondence.
- **FR-002**: The sync process MUST NOT modify OAP files without user approval
  (checkpoint gates).
- **FR-003**: The sync process MUST identify unmapped upstream changes and
  report them — unmapped changes may indicate the manifest needs updating.
- **FR-004**: The sync process MUST preserve OAP's three-layer architecture.
  An upstream change to a monolithic skill file must be decomposed into the
  appropriate process, contract, and adapter targets.
- **FR-005**: The `last_synced_sha` MUST only be updated after all approved
  changes are applied and verified.
- **FR-006**: The sync process MUST be idempotent — running it twice with no
  upstream changes produces no modifications.

## 7. Non-Functional Requirements

- **NF-001**: The sync process runs entirely locally. No network calls beyond
  git operations.
- **NF-002**: The mapping manifest is human-readable YAML, editable without
  tooling.
- **NF-003**: The sync process must work when an upstream repo is unavailable
  (graceful skip with warning).

## 8. Relationship to Existing Specs

- **Spec 074** (Factory Ingestion) — defined the original ingestion of the
  Elucid prototype. This spec supersedes the one-time ingestion with a
  repeatable sync protocol.
- **Spec 075** (Factory Workflow Engine) — the Rust engine reads factory/
  artifacts. Sync changes must not break the engine's expectations.
- **Spec 087** (Unified Workspace Architecture) — factory is a workspace
  execution artifact. The sync protocol maintains the factory's integrity
  as a workspace-level component.
