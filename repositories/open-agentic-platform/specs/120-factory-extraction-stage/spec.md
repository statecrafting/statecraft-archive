---
id: "120-factory-extraction-stage"
slug: factory-extraction-stage
title: Factory Extraction Stage
status: approved
implementation: complete
owner: bart
created: "2026-04-30"
amended: "2026-04-30"
kind: platform
domain: platform
risk: high
summary: >
  Promote the orphan `crates/artifact-extract` to a canonical, deterministic
  pre-stage of the Factory Phase 1 pipeline. Mirror statecraft's
  `ExtractionOutput` (spec 115) as Rust serde types in `factory-contracts` so
  the Rust producer and TypeScript consumer share one schema. Add an
  `s-1-extract` stage to `crates/factory-engine` that consumes the
  `KnowledgeBundle[]` delivered by the duplex envelope (spec 110), produces
  one typed `extraction-output.json` per object into the unified artifact
  store (spec 094), and posts the same payload back to a new content-addressed
  statecraft endpoint. Stage 1's business-requirements-analyst consumes the
  typed structure (text, pages, outline, language, agent provenance) instead
  of flat `.txt` paths, closing the raw-bytes-to-stage-1 reinterpretation seam.
  This spec is the carrier for spec 121 (claim provenance enforcement) and
  spec 122 (stakeholder-doc inversion); it does NOT enforce per-claim
  citations or invert Stage CD.
depends_on:
  - "074-factory-ingestion"  # factory-ingestion (framework conventions)
  - "075-factory-workflow-engine"  # factory-workflow-engine (Phase 1 stage list)
  - "077-statecraft-factory-api"  # statecraft-factory-api (endpoint surface)
  - "094-unified-artifact-store"  # unified-artifact-store (stage output destination)
  - "110-statecraft-to-opc-factory-trigger"  # statecraft-to-opc-factory-trigger (KnowledgeBundle + duplex auth)
  - "115-knowledge-extraction-pipeline"  # knowledge-extraction-pipeline (ExtractionOutput schema source)
establishes:
  - unit: { kind: file, path: crates/factory-contracts/src/knowledge.rs }
  - unit: { kind: file, path: crates/factory-engine/src/stages/s_minus_1_extract.rs }
  - unit: { kind: file, path: platform/services/statecraft/api/knowledge/extractionExternal.ts }
  - unit: { kind: file, path: product/apps/opc/src/components/factory/ArtifactInspector.tsx }
extends:
  - spec: "075-factory-workflow-engine"
    nature: additive
    unit: { kind: file, path: crates/factory-engine/src/manifest_gen.rs }
  - spec: "075-factory-workflow-engine"
    nature: additive
    unit: { kind: file, path: crates/artifact-extract/Cargo.toml }
  - spec: "075-factory-workflow-engine"
    nature: additive
    unit: { kind: file, path: crates/artifact-extract/src/lib.rs }
  - spec: "108-factory-as-platform-feature"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/factory.rs }
  - spec: "108-factory-as-platform-feature"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/statecraft_client.rs }
  - spec: "108-factory-as-platform-feature"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/knowledge/extractionOutput.ts }
---

# 120 — Factory Extraction Stage

**Feature Branch:** `120-factory-extraction-stage`
**Created:** 2026-04-30
**Status:** Draft
**Input:** "Raw bundles arrive at the factory as opaque file paths. Stage 1 reinterprets them every run. Make raw → typed extraction a deterministic pre-stage of the pipeline, with one schema across Rust and TS."

## 1. Problem

The Factory pipeline today receives knowledge as a sidecar, not a stage. Statecraft pre-resolves `KnowledgeBundle[]` and ships presigned URLs over the duplex envelope (spec 110). OPC materialises the bundles locally and passes file paths into `factory-run --business-docs` (`product/apps/opc/src-tauri/src/commands/factory.rs`, around L2206–L2217). The factory engine never sees statecraft's typed `ExtractionOutput` (spec 115) — only the local file paths.

Two extraction systems exist and don't talk to each other:

- `crates/artifact-extract/` — a Rust libbin that emits flat `.txt` files with a provenance header. It is **orphan**: no other crate in the repo depends on it. Verified in `.derived/codebase-index/index.json` and by grepping `crates/*/Cargo.toml`.
- `platform/services/statecraft/api/knowledge/extractors/*` — TypeScript, dispatched by `extractionWorker.ts`, emits typed `ExtractionOutput` JSONB validated by Zod (`extractionOutput.ts:49-58`). Writes happen only inside `runExtractionWork`. There is no REST endpoint that accepts `ExtractionOutput` from an external caller.

Three concrete consequences:

1. **Stage 1 reinterprets raw evidence on every run.** The `business-requirements-analyst` skill (in `legacy-factory` as of upstream sync, and absorbed into `factory-engine` skills under `crates/factory-engine/skills/`) is a single LLM call that reads heterogeneous extracted text without page boundaries, structural outline, or extractor provenance. Reinterpretation drift is structural, not incidental — the same inputs land at Stage 1 differently shaped each run.
2. **OPC has no write surface for extraction output.** Today's OPC → Statecraft writes (`product/apps/opc/src-tauri/src/commands/statecraft_client.rs:483-550`) cover orchestrator events (`ingest_events`) and artifact metadata (`record_artifacts`) — neither carries an extraction payload. A factory run that produces structured extraction has nowhere to put it back.
3. **Statecraft's `resolveKnowledgeForFactory` (`api/knowledge/knowledge.ts` around L1397–L1440) gates ingestion on `state === "available"`.** A typed extraction produced by OPC cannot advance an object even to `extracted` from outside, because the state machine accepts an `extraction_output` only via the legacy `transitionState` stub or the internal worker.

This spec closes the seam: one schema, one canonical extractor (Rust, deterministic-only), one stage in the pipeline, one content-addressed endpoint to write back.

It does **not** enforce that downstream claims (`STK-*`, `INT-*`, `BR-*`) cite the extraction corpus — that invariant lives in spec 121, which depends on this spec's typed output as its citation anchor.

## 2. Goals

- **One schema across Rust and TypeScript.** Statecraft's `ExtractionOutput` (`extractionOutput.ts`) is the source of truth. `crates/factory-contracts/src/knowledge.rs` mirrors it as serde types, with the schema version embedded as a compile-time const so any drift fails CI at build time, not at runtime (per the project's compile-time-schema discipline).
- **`artifact-extract` becomes canonical and deterministic-only.** The crate is promoted from orphan to a direct dependency of `factory-engine`, refactored to emit `ExtractionOutput` instead of flat `.txt`, and scoped to deterministic mime types (plain text, markdown, JSON, CSV, embedded-text PDF, DOCX). The crate does NOT call any model.
- **`s-1-extract` is the first stage of Phase 1.** Added to `manifest_gen.rs` ahead of s0. Inputs: `KnowledgeBundle[]` materialised by OPC. Outputs: one `extraction-output.json` per knowledge object, written to the local artifact store, plus an index entry mapping `(knowledgeObjectId, contentHash) → artifactId`.
- **Yield-back for agent extraction.** When a bundle's mime type requires agent extraction (image-only PDF, scan, audio), `s-1-extract` does NOT call a model. It posts a statecraft yield request, marks the object as `pending-agent-extraction` in the local manifest, and waits (with timeout) for the server-side worker (spec 115) to fill in the typed output. Agent extraction stays on the server where keys, governance, and cost ceilings live.
- **Stage 1 reads typed extraction.** The `business-requirements-analyst` prompt-context mechanism is fed the structured `ExtractionOutput` (text + pages + outline + language + extractor provenance), not raw paths. Raw paths remain available as a fallback for `--business-docs` direct invocations.
- **Content-addressed write-back to statecraft.** A new endpoint `POST /api/projects/:projectId/knowledge/objects/:objectId/extraction-output` accepts an externally-produced `ExtractionOutput`, idempotent on `(object_id, content_hash)`. OPC posts the same payload it wrote locally; statecraft stores it as a versioned extraction record. The state machine advances `imported → extracting → extracted` via the same transitions the internal worker uses.
- **OPC and statecraft become co-equal producers.** Both write content-addressable extraction versions; neither overwrites the other. `resolveKnowledgeForFactory` picks the most-recent successful version when more than one exists.
- **ArtifactInspector renders typed output.** The desktop inspector adds a viewer for `ExtractionOutput` distinct from the existing markdown/yaml/json viewers, surfacing pages, outline, language, and `agentRun` provenance when present.

## 3. Non-Goals

- **Per-claim provenance enforcement.** FAC-S1-011, QG-13, the `provenance.json` artifact, the `anchorHash` ID-stability registry, and the external-entity allowlist all live in **spec 121**. This spec produces the corpus that 121 cites against; it does not validate citations.
- **Stage CD inversion.** Reclassifying `client-document.md` and `project_charter.md` from outputs to authored inputs, and inverting Stage CD from generator to comparator, lives in **spec 122**.
- **Classification stage.** `extracted → classified → available` is the same boundary spec 115 deferred. Out of scope here for the same reasons.
- **Agent extraction on the OPC side.** OPC-side `artifact-extract` is deterministic-only. Vision, OCR, and audio remain server-side under the spec 115 worker. A future spec may revisit this for air-gapped deployments; not in V1.
- **Replacing the statecraft worker.** Server-side extraction continues to be the authoritative path for connector-synced objects. OPC writes are an additional channel for OPC-driven factory runs, not a replacement.
- **Re-extraction on schema bump.** When the shared `ExtractionOutput` schema version advances, existing extracted artifacts are not auto-recomputed. A backfill is operational work with its own spec.
- **Streaming extraction back to the dashboard.** s-1-extract produces a finalised payload per object; partial / per-page streaming is not in scope.

## 4. User Scenarios & Testing

### User Story 1 — Bundle of mixed text/PDF reaches Stage 1 as structured input (Priority: P1)

A workspace operator triggers a factory run for a project whose `KnowledgeBundle` contains: `requirements.md`, `business_case.docx`, `proposal.pdf` (embedded text). OPC receives the duplex envelope, materialises the bundles to the local artifact store, and `s-1-extract` runs as the first Phase-1 stage. Each object produces a typed `extraction-output.json`. Stage 1's prompt context is populated from those typed outputs (text + pages + outline + language). Stage 1 produces a BRD whose downstream stages can later cite specific pages of specific objects.

**Why this priority:** This is the headline behaviour. Without it, Stage 1 reinterprets raw bytes every run and spec 121 has no anchor to validate citations against. Every other story is a refinement.

**Independent Test:** Trigger a factory run with a 3-object bundle (md + docx + embedded-text PDF). Verify (a) the local artifact store contains 3 `extraction-output.json` files keyed by `(knowledgeObjectId, contentHash)`, (b) each conforms to the shared schema (validated by serde + Zod fixtures asserting they parse identically on both sides), (c) Stage 1's prompt context references pages and outline (not raw paths), (d) the statecraft endpoint received 3 POSTs and three new versioned extraction records exist server-side.

**Acceptance Scenarios:**

1. **Given** a factory run that consumes a `KnowledgeBundle[]` of three deterministic-eligible objects, **When** `s-1-extract` executes, **Then** three `extraction-output.json` artifacts are written to the unified artifact store, each carrying `text`, `pages[]` (where applicable), `language`, `outline[]` (where structurally derivable), `metadata`, and `extractor.kind ∈ {"deterministic-text", "deterministic-pdf-embedded", "deterministic-docx"}` with no `extractor.agentRun`.
2. **Given** the three artifacts above, **When** `s-1-extract` posts to `POST /api/projects/:projectId/knowledge/objects/:objectId/extraction-output`, **Then** statecraft stores three new extraction records keyed by `(object_id, content_hash, extractor.version)`, advances each `knowledge_object.state` to `extracted` via the same transition the internal worker uses, writes `audit_log` rows of `knowledge.extracted` with `metadata.source = "opc-s-1-extract"`, and broadcasts `knowledge.object.updated`.
3. **Given** Stage 1's prompt-context assembler, **When** it loads inputs for `business-requirements-analyst`, **Then** it reads the typed `ExtractionOutput` for each object via the artifact-store index (NOT raw `.txt` paths), and the assembled prompt includes per-object section markers (`### {filename} (pages 1-5)`).
4. **Given** the same run is replayed against the same bundles (no content changes), **When** `s-1-extract` runs again, **Then** the local artifact-store dedupes on `(knowledgeObjectId, contentHash)` and writes nothing new; the statecraft endpoint also dedupes and returns `200 OK { duplicate: true, existingExtractionId }`; no model call is made; no second `audit_log` row is emitted.

---

### User Story 2 — Image-only PDF in a bundle yields back to statecraft (Priority: P1)

The bundle contains `signed-contract-scan.pdf` (3 pages, no embedded text). `s-1-extract` runs the deterministic embedded-text pre-pass, finds zero text on every page, and instead of attempting a model call locally, posts a yield request to statecraft. The server-side spec-115 worker picks up the work, runs `agent-pdf-vision` under the workspace's policy bundle, writes the typed `ExtractionOutput` to the same content-addressed key, and notifies OPC via the duplex channel. `s-1-extract` resumes, fetches the now-available extraction by `(objectId, contentHash)`, writes a local copy to the artifact store, and proceeds to s0.

**Why this priority:** Real bundles include scans. Without yield-back, OPC would either need API keys + governance locally (multiplying the attack surface and duplicating policy) or fail loudly on every scan. P1 because regulated-sector projects ingest scans by default.

**Independent Test:** Trigger a run with a bundle containing one image-only PDF. Verify (a) `s-1-extract` did NOT make any HTTP call to a model provider, (b) it posted exactly one yield request to statecraft, (c) after the server-side worker completes, OPC received a duplex notification, (d) the local artifact store eventually contains the typed `extraction-output.json` with `extractor.kind = "agent-pdf-vision"` and `extractor.agentRun.modelId` populated, (e) Stage 1 received the same shape it would for deterministic objects.

**Acceptance Scenarios:**

1. **Given** a bundle object whose deterministic pre-pass returns zero text, **When** `s-1-extract` decides to yield, **Then** it posts to a new endpoint `POST /api/projects/:projectId/knowledge/objects/:objectId/yield-extraction` with `{ requestedExtractorKind?: string, contentHash, reason }`, and the statecraft server enqueues a run on `KnowledgeExtractionRequestTopic` (the same topic spec 115 defines) — OPC does not bypass the existing worker pipeline.
2. **Given** a yield in flight, **When** the OPC stage waits, **Then** it subscribes to the duplex channel for `knowledge.object.updated` events for the awaited `(objectId, contentHash)` with a configurable timeout (default 600s, env `OAP_FACTORY_S1EXTRACT_YIELD_TIMEOUT_SEC`).
3. **Given** the timeout expires, **When** the stage handles the timeout, **Then** it fails with a typed `s_minus_1_extract.yield_timeout` error carrying the unresolved object ids; the factory pipeline halts at this stage (per orchestrator rule 4) and surfaces the error in the desktop UI for operator action.
4. **Given** the server-side worker completes, **When** OPC receives the duplex notification, **Then** `s-1-extract` fetches the typed output via `GET /api/projects/:projectId/knowledge/objects/:objectId/extraction-output?contentHash=:hash`, writes a local copy to the artifact store, and proceeds.

---

### User Story 3 — Schema drift between Rust and TS fails CI (Priority: P1)

A contributor edits `extractionOutput.ts` to add a new required field, but does not update `crates/factory-contracts/src/knowledge.rs`. CI runs the schema parity check, detects the divergence, and fails the build with a message naming both files and the missing field. The contributor cannot merge without updating both sides.

**Why this priority:** The whole value of this spec is one schema, not two. Drift would silently re-introduce the very gap the spec closes. The check must be a hard build failure, not a warning.

**Independent Test:** Add a required field to `extractionOutput.ts`, run `make ci`. The build MUST fail with a non-zero exit and an error referencing the Rust mirror file. Revert. Re-run. Build succeeds.

**Acceptance Scenarios:**

1. **Given** a new commit that modifies `extractionOutput.ts`, **When** `make ci` runs, **Then** the schema parity check (`tools/oap/schema-parity-check` or equivalent — implementation choice) compares the Zod schema's structural fingerprint with the Rust serde fingerprint, and fails the build if the two differ.
2. **Given** the parity check passes, **When** Rust code constructs an `ExtractionOutput` and serializes it, **Then** statecraft's Zod parser accepts it without modification across a fixture set covering all extractor kinds.
3. **Given** the parity check fails, **When** the contributor reads the error output, **Then** the message names (a) the source-of-truth file (`extractionOutput.ts`), (b) the mirror file (`crates/factory-contracts/src/knowledge.rs`), (c) the specific divergence (added field, removed field, type mismatch), and (d) the schema version each side claims.

---

### User Story 4 — Server and OPC versions co-exist; resolver picks the latest (Priority: P2)

An object was extracted server-side via the connector pipeline (spec 115 worker). Later, the same project is opened in OPC and a factory run kicks off. `s-1-extract` re-extracts the same object content_hash deterministically (perhaps the original was via agent and a deterministic version is now possible because the extractor was upgraded). Two extraction records exist for the same `(object_id, content_hash)`. `resolveKnowledgeForFactory` picks the most-recent successful one for downstream factory ingestion.

**Why this priority:** Once content-addressing is in place, multiple producers are inevitable — connector re-syncs, OPC re-runs, server backfills. Resolver must pick deterministically. P2 because v1 will mostly see one producer per object.

**Independent Test:** Seed an object with two extraction records (server-side + OPC-side). Call `resolveKnowledgeForFactory`. Assert it returns the most-recent successful record. Verify the resolver records its choice in an audit row of action `knowledge.extraction_resolved` with both candidate ids and the winner.

**Acceptance Scenarios:**

1. **Given** an object with two extraction records sharing the same `content_hash` but different `extractor.kind`, **When** `resolveKnowledgeForFactory` is called, **Then** it returns the most-recent record whose `status = "completed"`.
2. **Given** the most-recent record is `failed`, **When** the resolver runs, **Then** it falls back to the next-most-recent `completed` record, NOT to the failed one.
3. **Given** every record for the object is `failed`, **When** the resolver runs, **Then** it returns a typed `no_successful_extraction` result with the failed record list — it does NOT silently skip the object.

---

### Edge Cases

- **Bundle delivers an empty file.** Deterministic-text extractor produces `text = ""`. Treat as `extractor_failed` with `error.code = "empty_input"`, NOT as a successful zero-length extraction. Operator must replace the file or remove it from the bundle.
- **Magic-number mismatch on a bundle object.** Same handling as spec 115 FR-014: re-sniff, update the bundle's declared mime, re-pick the extractor. If sniffed mime requires agent extraction, yield to statecraft.
- **Yield-back returns an `ExtractionOutput` that fails Rust deserialization.** The stage fails with `s_minus_1_extract.yield_returned_malformed` and surfaces the Zod-passing-but-Rust-failing payload in the error envelope so the parity check can be tightened.
- **Two yields for the same `(objectId, contentHash)` in flight concurrently.** The endpoint dedupes — the second yield returns the in-flight run's id; both stages await the same notification.
- **Statecraft endpoint returns 5xx on POST.** OPC retries with exponential backoff (3 attempts). On final failure, the local extraction artifact remains on disk and the run row carries `lastWriteBackError`; a separate sync-up job can drain on next factory run.
- **Local artifact store is full.** `s-1-extract` fails fast with `local_store_full` and does NOT attempt the network write — the stage halts and surfaces the operator action.
- **Bundle delivers an object whose `content_hash` does not match the bytes after download.** Treat as `bundle_integrity_failed` and refuse to extract; this is a spec-110 invariant violation, not a spec-120 concern, but `s-1-extract` must surface it cleanly rather than silently re-hashing and proceeding.
- **`KnowledgeBundle` references a knowledge object that no longer exists in statecraft.** Yield-back fails with `404`; the stage fails with `s_minus_1_extract.object_gone`, and the operator must refresh the bundle.
- **Schema version embedded in the OPC binary is older than the version the statecraft endpoint requires.** The endpoint rejects with `precondition_failed` code `schema_version_too_old`. OPC surfaces a "desktop update required" banner and halts the run cleanly.

## 5. Requirements

### 5.1 Functional Requirements

#### Schema mirror

- **FR-001**: A new module `crates/factory-contracts/src/knowledge.rs` MUST define serde types that mirror `platform/services/statecraft/api/knowledge/extractionOutput.ts` exactly. The Rust types include `ExtractionOutput`, `ExtractionPage`, `ExtractionOutlineEntry`, `Extractor`, `AgentRun`, and `TokenSpend`. Field names use serde rename to match the camelCase TS shape.
- **FR-002**: The schema version MUST be a compile-time const `pub const KNOWLEDGE_SCHEMA_VERSION: &str = "1.x.x"` in the Rust mirror, and a corresponding `export const KNOWLEDGE_SCHEMA_VERSION = "1.x.x"` in the TS source. Both MUST be declared `as const` / `const` so they are resolvable at compile/build time.
- **FR-003**: A new check `tools/oap/schema-parity-check` (or equivalent — implementation choice does not pin tool name) MUST run as part of `make ci` and `make registry`. The check MUST: (a) read the Zod schema's structural fingerprint, (b) read the Rust serde structural fingerprint, (c) compare the two, (d) exit non-zero with a diagnostic message naming both files and the divergence on mismatch.
- **FR-004**: Any modification to `extractionOutput.ts` that does not have a corresponding modification to `knowledge.rs` MUST fail CI. The reverse also holds.

#### Canonical extractor

- **FR-005**: `crates/artifact-extract` MUST be refactored to expose a public function `pub fn extract_deterministic(input: &Path, mime: &str) -> Result<ExtractionOutput, ExtractError>` that emits the typed `ExtractionOutput` from FR-001. The legacy flat-`.txt`-with-header output MUST be removed.
- **FR-006**: `artifact-extract` MUST handle exactly the deterministic mime predicates from spec 115 FR-011: `text/plain`, `text/markdown`, `application/json`, `text/csv`, `application/pdf` (embedded-text only), `application/vnd.openxmlformats-officedocument.wordprocessingml.document`. For any other mime, the function MUST return `ExtractError::RequiresAgent { suggested_kind, reason }`.
- **FR-007**: `artifact-extract` MUST NOT depend on any LLM client crate. The crate's `Cargo.toml` MUST NOT include `anthropic-sdk`, `reqwest` to model endpoints, or equivalent. A lint MUST enforce this.
- **FR-008**: `artifact-extract` MUST be added as a `[dependencies]` entry in `crates/factory-engine/Cargo.toml` and removed from the orphan list. The codebase-indexer MUST report zero orphan crates after this spec ships.
- **FR-009**: Each extractor implementation in `artifact-extract` MUST declare `MAX_BYTES` and refuse files larger than that cap with `ExtractError::TooLarge { limit, actual }`. Caps mirror spec 115 FR-013.

#### s-1-extract stage

- **FR-010**: `crates/factory-engine/src/manifest_gen.rs` MUST be modified to insert `s-1-extract` as the first stage of Phase 1, ahead of s0. The stage's input is the materialised `KnowledgeBundle[]` (one path per object plus `(knowledgeObjectId, contentHash, mime, sizeBytes)`). The stage's output is one `extraction-output.json` per object plus an index entry `(knowledgeObjectId, contentHash) → artifactId` in the unified artifact store.
- **FR-011**: A new module `crates/factory-engine/src/stages/s_minus_1_extract.rs` MUST implement the stage. It MUST: (a) iterate the bundle, (b) for each object call `artifact-extract::extract_deterministic`, (c) on success write the typed output to the local artifact store via `crates/factory-engine/src/artifact_store.rs` (`store_artifact` around L22–L136), (d) on `RequiresAgent`, post a yield to statecraft and await the duplex notification.
- **FR-012**: The stage MUST be deterministic for the same inputs. Replaying the same `KnowledgeBundle[]` (same `(objectId, contentHash)` set) MUST produce the same artifact-store ids — verified by hashing the canonical serialised `ExtractionOutput`.
- **FR-013**: On any per-object failure, the stage records the failure in the stage manifest but continues processing remaining objects. The stage as a whole fails ONLY if (a) ≥ one object yielded with `yield_timeout`, OR (b) ≥ one object failed with a non-yieldable error and `OAP_FACTORY_S1EXTRACT_TOLERATE_PARTIAL` is unset.
- **FR-014**: Stage 1's prompt-context assembler MUST consume the typed `ExtractionOutput` from the artifact store (not raw paths). The existing `--business-docs` direct-path invocation remains supported for ad-hoc CLI use, but inside the orchestrated pipeline the typed path is mandatory.
- **FR-015**: The stage MUST emit one `factory.stage.completed` event per stage invocation with `metadata.s1ExtractSummary = { objectsProcessed, deterministicCount, agentYieldedCount, failedCount }`, surfaced in the OPC desktop pipeline view.

#### Statecraft endpoint surface

- **FR-016**: A new endpoint `POST /api/projects/:projectId/knowledge/objects/:objectId/extraction-output` MUST be added to `platform/services/statecraft/api/knowledge/`. The handler MUST: (a) authenticate via the same duplex-channel identity used by `ingest_events` and `record_artifacts` (spec 110), (b) verify the caller has workspace membership for the owning workspace, (c) parse and Zod-validate the body as `ExtractionOutput`, (d) reject with `precondition_failed` / `schema_version_too_old` if the body's schema version is older than the server's minimum, (e) compute the idempotency key `(object_id, content_hash, extractor.version)` and return the existing record id with `{ duplicate: true }` if already present, (f) otherwise insert a new `knowledge_extraction_runs` row in `completed` state with the supplied output and advance the object state if currently `imported` or `extracting`.
- **FR-017**: The endpoint MUST emit `audit_log` action `knowledge.extracted` with `metadata.source = "opc-s-1-extract"`, the supplied `extractor` block, and the externally-supplied `agentRun` if present. This is distinct from the internal worker's audit row (`metadata.source = "statecraft-worker"`).
- **FR-018**: A new endpoint `POST /api/projects/:projectId/knowledge/objects/:objectId/yield-extraction` MUST exist for the OPC yield path. The handler MUST: (a) authenticate as in FR-016, (b) accept `{ contentHash, requestedExtractorKind?, reason }`, (c) call the existing `enqueueExtraction` helper (spec 115 FR-003) so the yield reuses the same worker pipeline, (d) return the run id and a duplex topic identifier OPC can subscribe to.
- **FR-019**: A new endpoint `GET /api/projects/:projectId/knowledge/objects/:objectId/extraction-output?contentHash=:hash` MUST exist for OPC to fetch a typed output produced server-side. It MUST return the most-recent successful record for the supplied `contentHash`, or `404` if none exists.
- **FR-020**: `resolveKnowledgeForFactory` (`api/knowledge/knowledge.ts` around L1397–L1440) MUST be updated to handle the case where multiple extraction records exist for the same `(object_id, content_hash)`. The resolution rule: most-recent `completed` wins; ties broken by `completed_at` descending; failed records are skipped, never returned. The resolver MUST emit `audit_log` action `knowledge.extraction_resolved` recording the candidate ids and the winner.

#### OPC client surfaces

- **FR-021**: `product/apps/opc/src-tauri/src/commands/statecraft_client.rs` MUST gain three Tauri commands: `post_extraction_output(project_id, object_id, payload)`, `request_extraction_yield(project_id, object_id, content_hash, reason)`, and `fetch_extraction_output(project_id, object_id, content_hash)`. All three MUST authenticate via the existing duplex identity.
- **FR-022**: `product/apps/opc/src-tauri/src/commands/factory.rs` MUST be updated so the `--business-docs` flow first invokes `s-1-extract` (when called from inside the orchestrated pipeline) and only falls back to direct file-path passing when called from the CLI in standalone mode (`--no-pipeline-extract`).
- **FR-023**: `product/apps/opc/src/components/inspector/ArtifactInspector.tsx` MUST render a typed-extraction view for artifacts whose mime is `application/x-extraction-output+json`. The view MUST show: full text (with show-full toggle for long output), pages with index + length, outline, language, and `extractor.kind` + `extractor.version` + (when present) `extractor.agentRun.modelId` / `extractor.agentRun.tokenSpend` / `extractor.agentRun.costUsd`.

#### Operational

- **FR-024**: Yield timeout default `OAP_FACTORY_S1EXTRACT_YIELD_TIMEOUT_SEC = 600`. Configurable per workspace via the standard env-resolution chain.
- **FR-025**: Concurrent extraction in `s-1-extract` capped by `OAP_FACTORY_S1EXTRACT_CONCURRENCY = 4` (default). Bundles with more than the cap process in parallel batches.
- **FR-026**: A failed write-back to statecraft MUST NOT fail the stage. The local artifact remains; `s-1-extract` records `writeBackPending` per object in the stage manifest; a sync-up job (out of scope for this spec, name reserved: `s-write-back-sync`) drains them on next factory run.
- **FR-027**: The legacy orphan code paths in `crates/artifact-extract` MUST be removed in the same change. No transitional dual-mode is shipped.

### 5.2 Key Entities

- **`ExtractionOutput`** (existing, mirrored): typed payload defined by `extractionOutput.ts`. This spec promotes it to a Rust-mirrored shared contract.
- **`KnowledgeBundle`** (existing, spec 110): array of objects materialised to OPC over the duplex envelope. `s-1-extract` consumes it.
- **`knowledge_extraction_runs`** (existing, spec 115): the table the new endpoint inserts into. No schema change here — the supplied output goes into existing columns.
- **`audit_log`** (existing, extended): the existing `knowledge.extracted` action gains `metadata.source ∈ {"statecraft-worker", "opc-s-1-extract"}`. The new `knowledge.extraction_resolved` action records resolver choices.
- **Artifact-store index** (existing, spec 094): gains an index over `(knowledgeObjectId, contentHash) → artifactId` for fast resolution from `s-1-extract` to downstream stages.

### 5.3 Permissions and audit

- The new POST/GET endpoints inherit the workspace-membership check used by `ingest_events` and `record_artifacts`.
- No new permission grade is introduced; OPC's duplex identity is sufficient because the supplied `ExtractionOutput` is auditable end-to-end via `metadata.source`.
- Every endpoint invocation produces an audit row (`knowledge.extracted` for POST, `knowledge.extraction_resolved` for resolver choices). GET endpoints do NOT audit by default; observability is via standard request logs.

### 5.4 Out-of-process operations

- The deterministic Rust extractors use Rust-native libraries (e.g. `lopdf` or `pdf-extract` for PDF, `docx-rs` for DOCX). Library choice is not pinned by spec but the parity-test fixture set MUST cover at least one document of each supported mime.
- `artifact-extract` MUST NOT call any model. Lint enforces.

## 6. Success Criteria

### Measurable Outcomes

- **SC-001**: For a bundle of 10 deterministic-eligible objects, `s-1-extract` completes in under 10s p95 on a developer machine (M-class Apple Silicon).
- **SC-002**: 100% of factory runs initiated through OPC's duplex envelope reach Stage 1 with structured `ExtractionOutput` in the prompt context (NOT raw `.txt` paths). Verified by an integration test that asserts the Stage 1 prompt assembler reads from the artifact store.
- **SC-003**: Schema parity check fails CI on any added/removed/typed-changed field in `extractionOutput.ts` that is not mirrored in `knowledge.rs`. Verified by a deliberate-drift regression test.
- **SC-004**: After this spec ships, `codebase-indexer` reports zero entries in the orphan-crate list (specifically: `artifact-extract` is no longer orphan).
- **SC-005**: A bundle containing one image-only PDF and two text files completes Stage 1 successfully, with the image-only PDF resolved via yield-back to the statecraft server-side worker. The factory run does NOT attempt any model call from OPC.
- **SC-006**: Replaying a factory run on the same bundle produces zero new extraction records (server-side or local). Idempotency verified by counting `knowledge_extraction_runs` rows before and after.
- **SC-007**: The endpoint rejects payloads whose schema version is older than the server minimum with `precondition_failed` / `schema_version_too_old` in 100% of test cases. Verified by a fixture set with deliberately-old payloads.
- **SC-008**: ArtifactInspector renders all `ExtractionOutput` fields for fixtures of every supported mime type. Visual regression test asserts the layout.
- **SC-009**: Yield timeout fires cleanly: a bundle whose server-side extraction takes longer than `OAP_FACTORY_S1EXTRACT_YIELD_TIMEOUT_SEC` halts the stage with `yield_timeout` and the desktop UI surfaces the unresolved object ids. Verified by a fault-injected test that stalls the server worker.
- **SC-010**: Resolver picks the most-recent successful extraction in 100% of multi-record fixtures, including: (a) two completed records, newer wins, (b) one completed + one failed (newer), completed wins, (c) all failed, returns `no_successful_extraction`.

## 7. Open Decisions

- **Synchronous vs partial yield-back.** V1 spec is synchronous: the stage waits for the duplex notification before proceeding. An alternative is a partial-stage where deterministic objects feed Stage 1 immediately and Stage 1 re-runs when yielded objects arrive. V1 chooses synchronous for simplicity; a future spec may revisit if yield-heavy bundles dominate.
- **Whether OPC should ever do agent extraction.** The v1 answer is no — keys, governance, and cost ceilings stay on the server. A future spec may revisit for air-gapped deployments where statecraft is unreachable; that scenario is currently out of project scope.
- **Whether `artifact-extract` should be split into per-mime crates.** Currently a single crate with a dispatch `match`. As the deterministic-mime list grows (CSV, RTF, ODT, etc.), the crate may need to split. V1: single crate; revisit when the dispatch exceeds ~10 arms.
- **Whether the statecraft endpoint should accept batched POSTs.** Bundles can be 50+ objects. Per-object POSTs are simple but chatty. V1: per-object POSTs with concurrency cap; revisit if profiling shows network round-trips dominate stage time.
- **Schema parity check tool name and home.** Could live in `tools/oap/schema-parity-check` (a new tool) or inside `make ci` as a script. V1 reserves the name but defers the implementation choice to plan.md.
- **Resolver tie-breaker on identical `completed_at`.** Currently descending by `completed_at`; if two records share the timestamp (clock skew), we'd want a deterministic tiebreaker. V1: `extractor.kind` lexicographic ascending. Open to revision before implementation.

## 8. Provenance

- `crates/artifact-extract/` — orphan crate this spec promotes to canonical; current flat-`.txt`-with-header output replaced by typed `ExtractionOutput`.
- `crates/factory-contracts/` — gains `src/knowledge.rs` mirroring statecraft's TS schema.
- `crates/factory-engine/src/manifest_gen.rs` — Phase 1 stage list extended; `s-1-extract` prepended.
- `crates/factory-engine/src/artifact_store.rs` (around L22–L136) — `store_artifact` is the existing seam this stage writes through.
- `product/apps/opc/src-tauri/src/commands/factory.rs` (around L2206–L2217) — current `--business-docs` path; updated so orchestrated runs pass through `s-1-extract`.
- `product/apps/opc/src-tauri/src/commands/statecraft_client.rs` (around L483–L550) — current write surfaces (`ingest_events`, `record_artifacts`); this spec adds three new Tauri commands alongside.
- `platform/services/statecraft/api/knowledge/extractionOutput.ts` (Zod schema around L49–L58) — schema source of truth; this spec freezes it as the shared contract.
- `platform/services/statecraft/api/knowledge/extractionCore.ts` — internal write path; the new external endpoint mirrors its idempotency rule.
- `platform/services/statecraft/api/knowledge/knowledge.ts` (around L1397–L1440) — `resolveKnowledgeForFactory` updated for multi-record selection.
- Spec 115 — extraction pipeline schema source and worker pattern; this spec extends it with an external write surface.
- Spec 110 — KnowledgeBundle delivery + duplex identity used by the new endpoints.
- Spec 094 — unified artifact store; destination for stage outputs.
- Spec 077 — statecraft-factory-api conventions; new endpoints follow these.
- Spec 075 — factory-workflow-engine; Phase 1 stage list this spec extends.
- Spec 074 — factory-ingestion conventions for adapter/stage definitions.
- Spec 121 (planned) — claim provenance enforcement; depends on this spec's typed corpus as the citation anchor.
- Spec 122 (planned) — stakeholder-doc inversion + Stage CD comparator; depends on 121 + 120.
