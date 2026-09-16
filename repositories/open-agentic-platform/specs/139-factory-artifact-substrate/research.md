---
spec: 139-factory-artifact-substrate
phase: 0
status: pending-user-direction
created: 2026-05-05
purpose: >
  Pre-implementation investigation for spec 139 (factory artifact substrate).
  Records four decisions D-1..D-4 that gate Phase 1. Surfaces the
  ≥3-kind-taxonomy-gaps halt trigger from tasks.md "Halt Conditions".
---

# Research — Factory Artifact Substrate (Phase 0)

> **Halt status (per tasks.md "Halt Conditions"):** Section 1 below
> surfaces **5 distinct new kinds** needed beyond the §4.2 enum. The
> halt threshold is ≥ 3. **User direction required for D-1 before Phase 1
> can start.** The other three decisions (D-2, D-3, D-4) are recorded
> below for the same checkpoint.

## Sources

- **Repo A** — `legacy-factory` @ `eca9b5a` (HEAD on `main` at audit time), in-scope subpath `Factory Agent/`.
- **Repo B** — `template` @ `e1de48c`, in-scope subpath `orchestration/` only (per spec 139 §3.2 non-goal "Mirroring the template scaffold tree").
- **OAP-native adapters** — `open-agentic-platform/_tmp/factory/adapters/{next-prisma,rust-axum,encore-react}/`.
- **agent_catalog schema** — `platform/services/statecraft/api/db/schema.ts:1098-1168` + migration `30_agent_catalog_org_rescope.up.sql`.
- **factory-engine** — `crates/factory-engine/` (and surrounding `factory-contracts`, `factory-platform-client`, `factory-project-detect`, `artifact-extract` crates).

---

## §1 — Upstream walk (T002): kind taxonomy + bundles + samples

### 1.1 Inventory totals

**Repo A (`legacy-factory/Factory Agent/`)** — 118 in-scope files:

| Kind | Count |
|---|---|
| `pipeline-orchestrator` | 1 |
| `agent` | 4 |
| `process-stage` | 8 |
| `skill` | 22 |
| `reference-data` | 21 |
| `sample-html` | 24 |
| **(unclassified)** | **38** |
| **Total** | **118** |

**Repo B (`template/orchestration/`)** — 7 in-scope files:

| Kind | Count |
|---|---|
| `pipeline-orchestrator` | 1 |
| `skill` | 6 |
| **Total** | **7** |

### 1.2 Unclassified files — D-1 INPUT (HALT THRESHOLD BREACHED)

The §4.2 enum does not cover 38 of 118 Repo A files. The unclassified files cluster into **5 distinct new kinds**:

| Proposed new kind | Count | Files |
|---|---|---|
| `page-type-reference` | 20 | All `Client_Interface/page-types/{authenticated,public}/page-type-*.md` (`type: reference`, no `parent`). The spec-side counterpart of every `samples/*.html`. |
| `sitemap-template` | 3 | `Requirements/Service/sitemap-template-{private-authenticated,public-authenticated,public}.json` — structural templates consumed by `svc-sitemap`. |
| `runtime-script` | 2 | `Orchestrator/scripts/{docx-generator,ppt-generator}.py` — Python scripts the orchestrator shells out to. |
| `binary-asset` | 3 | `Orchestrator/scripts/ppt-assets/{Disclaimer.png, Intro.png, sky-template.potx}` — binary deck assets. |
| `derived-summary` | 1 | `Requirements/System/service-specs/digest.md` — no frontmatter; derived markdown digest of the OpenAPI scrape. |
| **Other classification questions** | 9 | `Orchestrator/scripts/ppt-assets/deck-slides.json` borderline `runtime-script`/`reference-data`; `Requirements/Service/page-type-catalog.md` → `page-type-reference` if that kind lands; `svc-page-type-catalog.md` likewise. |

**5 distinct new kinds ≥ 3 ⇒ tasks.md "Halt Conditions" trigger fires. The §4.2 enum needs decision before Phase 1.**

Two additional taxonomy questions surfaced that don't add new kinds but require predicate clarification:

- **`type: stage-skill` vs `type: sub-agent` ambiguity.** All 8 `Orchestrator/factory-orchestration-*.md` files use `type: stage-skill` (not `type: sub-agent`). They match the `process-stage` predicate by path and would *also* match the `skill` predicate (`parent: <agent-id>` — they declare `parent: factory-orchestrator`). Sync worker needs a deterministic precedence rule. Suggestion: path-based predicates win over frontmatter-based predicates.
- **`factory-orchestration-tm.md` is a mode-detector, not a sequential pipeline stage.** It currently classifies as `process-stage` by path predicate, but spec §11 risk 2 already calls this out. Either accept the path-based classification or add a new `mode-detector` kind.

### 1.3 Frontmatter quirks

| Observation | Effect on substrate |
|---|---|
| 20 `page-type-*.md` files omit `parent:` entirely (not even `parent: none`) | Frontmatter parsing must accept "no parent field" without error |
| `tier:` field declared in **zero** files across both repos | §6.3 max_tier derivation must rely entirely on `tools_required ∪ tools_optional` for now; explicit `tier:` is forward-compat only |
| All agent / sub-agent / stage files declare `tools_required` and `tools_optional` (values: `Read, Write, Edit, Glob, Grep, Bash, Agent`) | Substrate must parse and store these as arrays in the `frontmatter` jsonb column |
| `template-orchestrator.md` (Repo B) uses custom keys: `scope:`, `defers_to:`, `skills_dir:`, `references:` | These must round-trip through the `frontmatter` jsonb column without semantic interpretation by the sync worker |
| 5 Repo B skill files use `variant_parameter: public | internal | dual` | Custom key, must round-trip |
| 20 page-type files use `viewTypes: [public, public-authenticated, private-authenticated]` | Custom key, must round-trip |
| `Requirements/System/service-specs/digest.md` has **no frontmatter at all** | Substrate must accept frontmatter-less .md files (frontmatter column = NULL) |

### 1.4 Bundle inventory — D-2 INPUT

Spec §4.3 names two bundles by example. The full path-predicate list:

| Bundle name | Path predicate | Files | Coupling rationale |
|---|---|---|---|
| `service-catalog` | `Requirements/System/service-catalog.json` ∪ `Requirements/System/service-specs/*.openapi.json` | 1 + 18 = 19 | service-catalog references slugs → 1:1 OpenAPI spec mapping |
| `fetch-meta` | `Requirements/System/service-specs/{_fetch-summary.json, digest.md}` | 2 | Both derived from same OpenAPI scrape run |
| `stage-2-pipeline` | `Requirements/Service/{service-requirements-orchestrator,service-description,audience-identification,audience-journey-map,future-state,sitemap}.md` | 6 | Phase A→B→C dependency chain in svc-req-orchestrator |
| `sitemap-templates` | `Requirements/Service/sitemap-template-*.json` | 3 | All consumed together by svc-sitemap |
| `factory-stage-s2` | `Orchestrator/factory-orchestration-s2.md` ∪ stage-2-pipeline bundle members | 7 | Stage envelope + execution body — spec §4.3 example |
| `client-doc-stage` | `Orchestrator/factory-orchestration-cd.md` ∪ `Requirements/Client/{client-document,project-charter,html-report-assembler,document-formatting}.md` | 5 | cd stage orchestrates two parallel branches, all share output path |
| `ppt-generator` | `Orchestrator/scripts/ppt-generator.py` ∪ `Orchestrator/scripts/ppt-assets/*` | 5 | Script reads all assets at runtime |
| `docx-generator` | `Orchestrator/scripts/docx-generator.py` (singleton) | 1 | No co-located assets (today) |
| `page-type-authenticated` | `Client_Interface/page-types/authenticated/page-type-*.md` ∪ `…/samples/*.html` | 12 + 13 = 25 | Each .md is the spec for the same-named HTML; ci-design-system reads both |
| `page-type-public` | `Client_Interface/page-types/public/page-type-*.md` ∪ `…/samples/*.html` | 8 + 11 = 19 | Same rationale, public viewType |
| `ci-agent` | `Client_Interface/{client-interface-orchestration,content-specification,design-system}.md` | 3 | ci-orchestrator references both sub-agents |
| `api-agent` | `Controllers/api-{orchestrator,builder,reviewer,security,rest-standards,web-standards}.md` | 6 | api-orchestrator references all 5 sub-agents |
| `template-orchestrator` | `orchestration/template-orchestrator.md` ∪ `orchestration/skills/*.md` | 7 | Entire Repo B; orchestrator references all 5 active skills |

13 bundle predicates total. Sync worker derives `bundle_id` deterministically from path matches.

### 1.5 Sample-HTML routing — D-3 INPUT

24 HTML samples found, all under `Client_Interface/page-types/{authenticated,public}/samples/*.html`. No `sample/` or `examples/` variants.

- **21 of 24** route cleanly: each `samples/<name>.html` has a corresponding `page-type-<name>.md` whose frontmatter `id` is the `bundle_id` primary.
- **3 orphans** lack a `.md` parent:
  - `authenticated/samples/settings-hub.html` (closest .md is `page-type-settings-form.md`)
  - `public/samples/accessibility-page.html` (no analogous .md)
  - `public/samples/privacy-page.html` (no analogous .md)
- **1 multi-sample bundle**: `public/samples/{form-step-1,form-step-2}.html` both bundle under `page-type-public-form-step.md`.

The §4.2 `sample-html` predicate (`**/samples/*.html`) and the bundle-derivation strategy (link to parent `.md` skill via path) work for the 21 clean cases. The 3 orphans need explicit handling: either (a) sync creates "parentless sample-html" rows tagged with no `bundle_id`, or (b) the sync worker emits a warning and the substrate maintainer authors the missing parent .md files.

### 1.6 Adapter manifest realities

**Neither upstream repo contains an `adapters/<name>/manifest.yaml` file** in the in-scope subpaths. The `adapter-manifest` kind is entirely a spec 139 net-new artifact shape — not a translation of an existing upstream concept. The `acme-vue-node` manifest referenced in spec §4.3 must be authored as part of spec 139 delivery (Phase 2 T055), not synced from upstream.

The closest existing analog is `template-orchestrator.md` (Repo B) frontmatter, which uses `id`, `name`, `description`, `type`, `scope`, `references`, `skills_dir`, `defers_to`. None of `template_remote`, `orchestration_source_id`, `scaffold_source_id`, `scaffold_runtime` exist anywhere in either repo.

---

## §2 — agent_catalog audit (T003)

### 2.1 Schema-level invariants

I do not have prod DB access from this session. The schema declarations (`platform/services/statecraft/api/db/schema.ts:1098-1168`) and migration history (`30_agent_catalog_org_rescope.up.sql`) provide the load-bearing invariants without a live query:

| Column | Constraint | Implication for Phase 2 backfill |
|---|---|---|
| `agent_catalog.frontmatter` | `jsonb NOT NULL` | Every row guaranteed to have parsed frontmatter — zero null-handling needed in T050 |
| `agent_catalog.body_markdown` | `text NOT NULL` | Every row has body — maps directly to `factory_artifact_substrate.user_body` |
| `agent_catalog.content_hash` | `text NOT NULL` | Every row has hash — Phase 2 byte-equality assertion (per tasks.md halt threshold "≥1% data divergence") is feasible |
| `agent_catalog.org_id` | `text NOT NULL` (after migration 30) | Migration 30 backfilled all rows with the canonical org; no orphaned project-scoped rows survive |
| `agent_catalog.UNIQUE (org_id, name, version)` | enforced | Maps cleanly to `factory_artifact_substrate.UNIQUE (org_id, origin='user-authored', path='user-authored/'||name||'.md', version)` |
| `agent_catalog_audit.action` | `AgentCatalogAuditAction = "create" \| "edit" \| "publish" \| "retire" \| "fork"` | T051 must define the source→target action mapping; not all 5 values map cleanly to the 6 substrate actions in §6.4 — see open question OQ-1 below |
| `project_agent_bindings.org_agent_id` | `FK ON DELETE RESTRICT` | Guarantees no orphaned bindings; T052 backfill is bijective |
| Migration 30's `agent_catalog_migration_30_log` table | precedent | Phase 2 should mirror this provenance pattern |

### 2.2 Runtime audit — DEFERRED

The runtime sweep ("does any production row violate a non-schema invariant?") cannot be done from this session. **Folded into Phase 2 task T040** (the migration dry-run test). Acceptance: T040 must explicitly assert frontmatter-non-null, body-non-empty, content-hash-matches-recomputed for every row, and halt the migration on the first violation. This satisfies the spirit of T003 inside the rigorous setting where it actually matters.

### 2.3 Open question — OQ-1: action mapping

The audit-action mapping needs a decision in T051 (Phase 2):

| `agent_catalog_audit.action` | Suggested `factory_artifact_substrate_audit.action` |
|---|---|
| `create` | `artifact.synced` (initial create) |
| `edit` | `artifact.overridden` (per spec §6.4 — user authored content) |
| `publish` | `artifact.synced` with status transition recorded in before/after JSONB |
| `retire` | `artifact.retired` |
| `fork` | new compound action OR `artifact.synced` for the forked row + `artifact.overridden` if forked-with-edits |

`fork` is the only action without a clean target. Resolution can land in T051 — non-blocking for D-1..D-4.

---

## §3 — OAP-native adapter audit (T004) — D-4 INPUT

### 3.1 Per-adapter inventory

**`next-prisma/`** (21 files): manifest.yaml ✅; 6 agents/*.md (all with id frontmatter ✅); 19 patterns/**/*.md (all missing frontmatter — by design); scaffold/README.md (placeholder, by design); validation/invariants.yaml ✅.

**`rust-axum/`** (19 files): manifest.yaml ✅; 5 agents/*.md ✅; 19 patterns/**/*.md (no frontmatter); scaffold/README.md; validation/invariants.yaml ✅.

**`encore-react/`** (20 files): manifest.yaml ✅; 5 agents/*.md ✅; 18 patterns/**/*.md (no frontmatter); scaffold/README.md; validation/invariants.yaml ✅.

### 3.2 manifest.yaml validation

All three parse as valid YAML. All three declare the same 12 top-level keys: `schema_version, adapter, stack, capabilities, supported_auth, supported_session_stores, commands, directory_conventions, patterns, agents, scaffold, validation`.

**None of `template_remote`, `orchestration_source_id`, `scaffold_source_id`, `scaffold_runtime` are present** in any of the three. Expected per spec §7.2 — these are added by Phase 2 T055 during ingestion.

### 3.3 Runtime mismatches (the actionable issue)

| Adapter | `stack.runtime` declared | Spec 112 §5.4 supported set |
|---|---|---|
| `next-prisma` | `node-22` | `node-24` only |
| `encore-react` | `node-20` | `node-24` only |
| `rust-axum` | `native` | n/a |

If `factory-contracts/src/validation.rs` is tightened to enforce `node-24` as the only Create-eligible runtime (which spec 112 §5.4 implies), `next-prisma` and `encore-react` are unscaffoldable on ingest. **Resolution choice belongs in D-4.**

### 3.4 Reference scan

Zero broken OAP references across all 57 pattern files. Internal cross-file references resolve to paths inside the *generated workspace* (e.g. `../db/drizzle`), not to OAP crate paths. Scaffold/README.md files reference the `factory-run` CLI and `--scaffold-source` flag; both verified to exist at `crates/factory-engine/src/bin/factory_run.rs:319,95`.

### 3.5 Duplication

`manifest.yaml.validation` duplicates `validation/invariants.yaml` content in all three adapters. T054 must pick a canonical location and stop reading the other.

### 3.6 D-4 recommendation

**Recommendation: ingest sanitised, with a narrow set of mechanical fixes:**

1. Pre-ingest update `stack.runtime: node-24` in `next-prisma` and `encore-react` manifests OR explicitly extend the substrate's accepted-runtime set with documented divergence.
2. T054 ingestion script injects `orchestration_source_id` / `scaffold_source_id` / `scaffold_runtime` per-adapter (additive — not pre-ingest).
3. Pick `validation/invariants.yaml` as canonical; remove the embedded `manifest.yaml.validation` block.
4. Decide whether substrate requires `id` frontmatter on patterns. If yes, T054 generates minimal frontmatter (`id: <adapter>-pattern-<rel-path>`, `adapter: <name>`, `category: <api|data|page-types|ui>`) at ingestion.

The content itself is otherwise ingest-ready. Items 1–4 are bounded and mechanical, not structural sanitisation. **User confirms or overrides as D-4.**

---

## §4 — factory-engine filesystem audit (T005)

### 4.1 `factory_root` API today

`pub factory_root: PathBuf` lives on `FactoryEngineConfig` at `crates/factory-engine/src/engine.rs:42`. Type today is `PathBuf` (matches plan §Phase 3 expectation).

Functions accepting it as `&Path` parameter (clean call sites):
- `AdapterRegistry::discover` (factory-contracts)
- `load_process_agents` (factory-contracts)
- `generate_process_manifest` (manifest_gen.rs:195)
- `generate_scaffold_manifest` (manifest_gen.rs:124, but param is `_` unused)
- `run_factory_gate_check` / `load_stage_checks` (verify_harness.rs:39,65)

CLI binary at `crates/factory-engine/src/bin/factory_run.rs:152,237` canonicalises a CLI arg into the config — clean.

### 4.2 Phase 3 surgery list (10 sites)

Not the happy path — `factory_root` is the primary abstraction but two parallel roots bypass it. Surgery sites, smallest → largest:

| # | File:Line | Type of change |
|---|---|---|
| 1 | `engine.rs:54-55` | Replace `PathBuf::from("factory")` Default with `FactoryRoot::Filesystem(PathBuf::from("factory"))`, or remove `Default` |
| 2 | `factory-contracts/src/adapter_registry.rs:64` | `&Path` → `&FactoryRoot`, dispatch on enum |
| 3 | `factory-contracts/src/agent_loader.rs:64` | Same lift |
| 4 | `factory-engine/src/verify_harness.rs:39,65` | 2 fns same lift |
| 5 | `factory-engine/src/manifest_gen.rs:124,195` | 2 fns; wire up the unused `_factory_root` in scaffold_manifest |
| 6 | `factory-engine/src/pipeline_state.rs:188,194` | Decide: take `&FactoryRoot` or pre-resolved `&Path` |
| 7 | `factory-engine/src/harness_state.rs:92,97` | Same decision |
| 8 | `factory-engine/src/stages/stage_cd.rs:47-52` | `StageCdInputs.artifact_store: PathBuf` — second independent root, likely stays `PathBuf` (artifact store ≠ factory root) |
| 9 | `factory-engine/src/artifact_store.rs:21,47-53` | `LocalArtifactStore::from_env()` resolves outside `factory_root` — Phase 3 must decide if `VirtualRoot` covers this root or only `factory_root` proper |
| 10 | `engine.rs:73-130` | All `.join(self.config.factory_root, …)` calls become resolver calls |

**Surrounding crates:**
- `factory-contracts` — clean (functions take `factory_root: &Path` as param).
- `factory-platform-client` — explicitly designed as the eventual *replacement* for `resolve_factory_root`; has its own `cache_root` (independent path-anchor to track).
- `factory-project-detect` — uses `project_dir`, not `factory_root` — no blocking issue.
- `artifact-extract` — operates on caller-supplied paths — orthogonal.

### 4.3 Phase 3 caveat to surface in plan

**Open scope question for Phase 3 (not for D-1..D-4):** Spec §8 talks about "OPC factory_root becomes a virtual root". It does not explicitly cover `LocalArtifactStore.base_dir` (the `~/.oap/artifact-store` root) or `StageCdInputs.artifact_store`. Phase 3 plan should clarify whether these are also virtualised or remain filesystem-anchored independently. Easiest: keep them filesystem-anchored; only `factory_root` proper goes virtual. This matches spec §8's wording and keeps the surgery scope to the 10 sites above.

---

## §5 — Decisions

The four decisions D-1..D-4 are recorded below. **Three are recommendations awaiting user confirmation; one (D-1) requires user direction because the halt threshold is breached.**

### D-1 — Final kind taxonomy

**STATUS: USER DIRECTION REQUIRED** (≥3 kind-taxonomy gaps surfaced; tasks.md halt condition fired).

**Recommendation:** Adopt all 5 new kinds — `page-type-reference`, `sitemap-template`, `runtime-script`, `binary-asset`, `derived-summary` — bringing §4.2's enum from 10 to 15 kinds. The walk-up evidence shows each is a real, distinct, recurring file shape with its own consumer needs, not a one-off curiosity:

- `page-type-reference` (20 files) — consumed by `ci-design-system`; the spec-side counterpart of `sample-html`. Without this kind, 17% of Repo A is unclassifiable.
- `sitemap-template` (3 files) — consumed by `svc-sitemap`. Distinct from generic JSON `reference-data` because they're structural templates, not data.
- `runtime-script` (2 files) — Python scripts the orchestrator shells out to. They're not skills, agents, stages, or data.
- `binary-asset` (3 files) — substrate must support binary content (PNG/POTX). Implication: `factory_artifact_substrate.user_body / upstream_body` must accept `bytea` or be split into a separate column; an `effective_body text generated stored` only works for text content. **This is a row-schema implication that Phase 1 T020 must address.**
- `derived-summary` (1 file, but kind is recurring) — frontmatter-less .md derived from another bundle. Distinct from `reference-data` which is structured.

**Two predicate clarifications also needed:**
- Path-based predicates take precedence over frontmatter-based for the `process-stage` vs `skill` ambiguity on `factory-orchestration-*.md`.
- `factory-orchestration-tm.md` stays in `process-stage` for now (path-predicate). Spec §11 risk 2 already flags this; revisit during Phase 1 prototyping.

**Schema implication:** Adopting `binary-asset` means the substrate row must accept binary content. Two options:
- (a) Add `upstream_body_bytes bytea` / `user_body_bytes bytea` columns; `effective_body` becomes `text` for text kinds and `null` for binary; consumers select by kind.
- (b) Store binary content base64-encoded in the existing `text` columns; flag the row's encoding in `frontmatter` or a new `encoding` column.

**Recommendation: option (a)** — explicit binary support, no encoding-discipline foot-gun. Option (b) would let a consumer mistakenly treat base64 as text.

**Awaiting user decision: adopt 5-kind expansion (Y/N), pick schema option (a) or (b), and confirm path-predicate precedence rule.**

### D-2 — Bundle inventory

**Recommendation: adopt the 13 path-predicate bundles from §1.4.** No halt trigger here.

The full list:
1. `service-catalog`
2. `fetch-meta`
3. `stage-2-pipeline`
4. `sitemap-templates`
5. `factory-stage-s2`
6. `client-doc-stage`
7. `ppt-generator`
8. `docx-generator`
9. `page-type-authenticated`
10. `page-type-public`
11. `ci-agent`
12. `api-agent`
13. `template-orchestrator`

Sync worker derives `bundle_id` from the path predicates (they are mutually exclusive in the current corpus). Phase 1 T024 implements the predicate-set in `syncPipeline.ts`.

### D-3 — Sample-HTML routing

**Recommendation: adopt as spec §4.2 currently writes it, with one extension:** the sync worker emits a `parentless-sample-html` warning (not error) for the 3 orphans (`settings-hub.html`, `accessibility-page.html`, `privacy-page.html`). Such rows enter the substrate with `bundle_id = NULL` and are surfaced in the conflict UI for manual binding.

Multi-sample bundles (`form-step-1.html` + `form-step-2.html` → `ci-page-public-form-step`) are supported natively by allowing N HTML samples per parent .md within a single bundle.

### D-4 — OAP-native adapter ingestion shape

**Recommendation: ingest sanitised, narrow.** The audit found content that is structurally well-formed (zero broken OAP refs, all manifests parse, all agents have `id` frontmatter) but has 4 mechanical issues that should land in T054's ingestion script:

1. Update `stack.runtime` to `node-24` in `next-prisma` and `encore-react` manifests, or document the divergence.
2. Inject `orchestration_source_id` / `scaffold_source_id` / `scaffold_runtime` keys.
3. Pick `validation/invariants.yaml` as canonical; drop `manifest.yaml.validation` duplicate.
4. Decide whether patterns get auto-generated minimal frontmatter (`id`, `adapter`, `category`); recommend YES so they index in the substrate.

If user prefers "ingest verbatim", a follow-up sanitisation spec must be filed before Phase 2 ships (per spec §11 risk 5).

---

## §6 — Halt declaration

**Per `.claude/rules/orchestrator-rules.md` Rule 4 and `tasks.md` "Halt Conditions":**

> Halt and consult before proceeding if:
> - Phase 0 research surfaces ≥ 3 kind-taxonomy gaps. The §4.2 enum may need substantive redesign before Phase 1.

**Status: 5 kind-taxonomy gaps surfaced; halt fires; user direction required on D-1 before Phase 1 starts.**

This is a recoverable halt of the kind CONST-005 + orchestrator-rule-4 expect — not a refusal to proceed. The substrate row schema (`factory_artifact_substrate.upstream_body / user_body / effective_body` text typing) is load-bearing for Phase 1 T020, and adopting `binary-asset` changes the schema decision before T020 lands. Surfacing now is cheaper than re-doing T020 after Phase 1 ships.

D-2, D-3, D-4 are recommendations awaiting confirmation but do not themselves block Phase 1.

---

## §7 — Out-of-scope observations recorded for downstream phases

1. **Migration sequence number is 32.** The next migration filename is `32_factory_artifact_substrate.up.sql` (current head is `31_create_factory_runs`). Phase 1 T020 uses this number.
2. **Phase 2 audit-action mapping (OQ-1).** `agent_catalog_audit.action: "fork"` has no clean target in §6.4. T051 must adjudicate.
3. **Phase 3 root-question (§4.3).** Spec §8 needs clarification on whether `LocalArtifactStore` and `StageCdInputs.artifact_store` are also virtualised or only `factory_root` proper. Recommendation: only `factory_root` proper.
4. **`adapter-manifest` is net-new.** No upstream `adapters/<name>/manifest.yaml` exists in either repo. T055 authors `acme-vue-node`'s manifest from scratch (not from upstream translation).
5. **Spec 139's frontmatter `code_aliases: ["FACTORY_ARTIFACT_SUBSTRATE"]`** has no current consumer; CONST-005 not affected.
