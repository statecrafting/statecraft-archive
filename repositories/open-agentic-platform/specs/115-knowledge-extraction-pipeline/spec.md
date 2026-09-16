---
id: "115-knowledge-extraction-pipeline"
slug: knowledge-extraction-pipeline
title: Knowledge Extraction Pipeline
status: approved
implementation: complete
owner: bart
created: "2026-04-27"
amended: "2026-05-08"
amendment_record: "143-presigned-upload-public-endpoint"
kind: platform
domain: platform
risk: high
summary: >
  Replaces the manual click-through `imported → extracting → extracted` state
  walk with an automatic, agent-aware extraction pipeline. On upload-confirm
  and on connector sync the worker dispatches by mime type to a deterministic
  fast path (plain text, markdown, structured JSON, PDFs with embedded text)
  or to an LLM-backed extractor (image-only PDFs, scans, images, audio). The
  extractor writes a typed `extraction_output` payload (text, pages, outline,
  language, metadata, model provenance), advances state through `extracting →
  extracted`, audits the run, and surfaces failures as a recoverable state
  with retry. The dashboard's manual "Advance to extracting/extracted"
  buttons are retired in favour of observational status with a Retry action
  on failed objects.
depends_on:
  - "036-safety-tier-governance"  # safety-tier-governance (governs extractor agent invocations)
  - "047-governance-control-plane"  # governance-control-plane (policy bundle gating model calls)
  - "087-unified-workspace-architecture"  # unified-workspace-architecture (knowledge intake domain, lifecycle)
  - "114-async-project-clone-pipeline"  # async-project-clone-pipeline (Topic + Subscription + run-row pattern reused here)
establishes:
  - unit: { kind: file, path: platform/services/statecraft/api/knowledge/extractionEvents.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/knowledge/extractionWorker.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/knowledge/extractionCore.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/knowledge/extractionOutput.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/knowledge/extractionPolicy.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/knowledge/auditActions.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/knowledge/prompts.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/knowledge/magic.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/knowledge/extractors/types.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/knowledge/extractors/dispatch.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/knowledge/extractors/index.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/knowledge/extractors/deterministic-text.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/knowledge/extractors/deterministic-pdf-embedded.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/knowledge/extractors/deterministic-docx.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/knowledge/extractors/agent-base.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/knowledge/extractors/agent-cost-helpers.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/knowledge/extractors/agent-pdf-vision.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/knowledge/extractors/agent-image-vision.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/knowledge/knowledge.ts }
  - unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.project.$projectId.knowledge.tsx }
  - unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.project.$projectId.knowledge.$id.tsx }
---

# 115 — Knowledge Extraction Pipeline

**Feature Branch:** `115-knowledge-extraction-pipeline`
**Created:** 2026-04-27
**Status:** Draft
**Input:** "Knowledge objects start as raw and need to be processed and extracted; today the dashboard's transition button just walks the state machine with no actual extraction. Wire the real pipeline."

## 1. Problem

Spec 087 §4.3 and §8 Phase 2 define a knowledge object lifecycle of `imported → extracting → extracted → classified → available` and call out an extraction stage that performs OCR, text extraction, classification, and structured-output generation. The state machine scaffolding shipped (`platform/services/statecraft/api/db/migrations/10_create_knowledge_intake.up.sql:16-58`, `api/knowledge/knowledge.ts:422-501`) but the pipeline did not. Today, advancement happens only when a human clicks "Advance to {nextState}" on `web/app/routes/app.project.$projectId.knowledge.$id.tsx:172-184` and the API blindly accepts whatever JSON the caller hands in for `extraction_output` (`knowledge.ts:475-477`).

This means:

- Every knowledge object effectively sits at `imported` forever — no usable text body, no language hint, no page structure, no metadata — because no caller exists that knows what to put in `extraction_output`.
- `resolveKnowledgeForFactory()` (`knowledge.ts:1397-1440`) gates factory ingestion on `state === "available"`, but objects can only reach `available` via four manual clicks per object. Bulk uploads are unworkable.
- There is no audit trail explaining *what* extracted an object — no model id, no extractor version, no token spend, no provenance for the bytes that end up driving downstream factory stages.
- Connector-driven sync (`scheduler.ts`, `connectors/*`) lands raw bytes in the workspace bucket and creates rows in `imported`, then stops. The connector loop has no hand-off into extraction.

The user's question framed it precisely: extraction is **not** agent-dependent today because it is not implemented at all. The state-machine endpoint is a stub a human walks by hand. This spec replaces that stub with a real pipeline that is *partly* agent-driven (vision/OCR/long-form extraction) and *partly* deterministic (already-text, already-JSON, embedded-text PDFs).

## 2. Goals

- **Automatic extraction.** When `confirmUpload` succeeds, OR when a connector `syncRun` registers a new object, the object is enqueued for extraction without operator intervention. Manual triggering is retained as a debug affordance only.
- **Typed extraction output.** `extraction_output` becomes a contract — not free-form JSON. Every extracted object MUST carry `text`, `pages[]` (when paginated), `language`, `outline[]` (when structurally extractable), `metadata` (mime-specific), and `extractor` provenance (`kind`, `version`, `agentRun?`).
- **Mime-driven dispatch.** A dispatch table picks the cheapest extractor that can produce a faithful payload for the object's mime type. Plain text and markdown skip the agent entirely; image-only PDFs and standalone images route to a vision-capable model; audio routes to a transcription model. The table is extensible — adding a new extractor is one entry, not an architectural change.
- **Governed agent calls.** Every model invocation passes through the policy bundle (spec 047) and the safety-tier registry (spec 036). The workspace's policy slice can disallow vision, disallow audio, set a per-call cost ceiling, or pin a model id. No raw `Anthropic` SDK call escapes the governance gate.
- **Resumable, observable runs.** Each extraction attempt is a row in a new `knowledge_extraction_runs` table with `status`, `extractorKind`, `agentRun` snapshot, `error`, `durationMs`, and timestamps. Workers pick up `pending` runs via PubSub and CAS-transition to `running`, mirroring the spec 114 clone pipeline. A failed extraction parks the object back at `imported` with `lastExtractionError` populated and exposes a Retry action.
- **Manual transition retired from the UX.** The dashboard buttons that walked the state machine click-by-click are removed. The detail page becomes observational (status badge + last error + Retry) with the click-walk preserved only behind a `?debug=1` query for incident response.

## 3. Non-Goals

- **Classification stage.** `extracted → classified → available` is the next stretch of the lifecycle. It is its own concern (taxonomy, governance, factory-stage relevance) and lands in a follow-up spec. This spec stops at `extracted`. (See §7 Open Decisions.)
- **Embeddings / vector indexing.** The factory's semantic search and embeddings story is downstream of extraction. We produce `text` faithfully; what to do with it is not in scope.
- **Live re-extraction on model upgrade.** When a better model ships, *existing* extracted objects are not automatically re-extracted. A backfill is a separate operational task with its own spec.
- **Streaming extraction.** Large PDFs are extracted as one unit. Per-page progress is recorded in `extraction_runs` but not surfaced as a streaming API.
- **Extracting from connectors that haven't been wired yet.** SharePoint / Azure Blob / S3 / GCS connectors exist as stubs (`connectors/*`); whatever they produce, the extraction pipeline accepts. Wiring those connectors end-to-end is independent work.
- **Replacing the state enum.** `knowledge_object_state` keeps its current five values. The change is in *who advances* the state and *what writes* `extraction_output`, not the shape of the state machine.

## 4. User Scenarios & Testing

### User Story 1 — Upload a PDF and have it become factory-ready without clicking anything (Priority: P1)

A workspace member opens the project's knowledge tab and uploads `proposal.pdf` (5 pages, embedded text). The upload completes. Within seconds the row's status badge moves from `imported` to `extracting`, then to `extracted`, with no further user interaction. Clicking the row reveals the extracted text, a 5-element `pages[]` array, an `outline` derived from the PDF's heading structure, a detected language of `en`, and an `extractor.kind = "deterministic"` (no agent involved — the PDF had embedded text). The user has spent zero clicks beyond the upload itself.

**Why this priority:** This is the headline behaviour. Without it, the rest of the platform's "knowledge feeds factory" story (087) collapses into manual data entry. Every other user story in this spec is a refinement on top of this one working.

**Independent Test:** From a fresh workspace, upload a small embedded-text PDF via the existing presigned-URL flow. Without clicking any state-transition button, observe the row reach `extracted` within 30s. Inspect `extraction_output` and assert it has `text` matching the PDF's text content, `pages.length === 5`, `language === "en"`, `extractor.kind === "deterministic"`. Inspect `knowledge_extraction_runs` and assert exactly one row with `status = "completed"`, `extractorKind = "deterministic-pdf-embedded"`, `agentRun = null`.

**Acceptance Scenarios:**

1. **Given** an authenticated user in a workspace with a default extraction policy, **When** they call `confirmUpload` on a freshly-uploaded `application/pdf` blob with embedded text, **Then** an `knowledge_extraction_runs` row is inserted at `pending` and a message is published to `KnowledgeExtractionRequestTopic` *within the same transaction-aligned sequence* as the existing `knowledge.upload_confirmed` audit row.
2. **Given** a `pending` run row, **When** the worker subscription fires, **Then** the worker CAS-transitions the run to `running`, the knowledge object's `state` advances to `extracting`, the deterministic extractor produces a typed payload, the object's `state` advances to `extracted` with `extraction_output` populated, the run row transitions to `completed` with `durationMs` set, an audit row of action `knowledge.extracted` is written, and a `knowledge.object.updated` broadcast is sent on the workspace sync channel.
3. **Given** the broadcast above, **When** the dashboard listing page is open, **Then** the row's status badge updates from `imported → extracting → extracted` without a manual refresh.
4. **Given** an extracted object, **When** the user opens its detail page, **Then** the page renders the extracted `text` (truncated with a "show full" toggle if long), `pages.length`, `language`, `outline[]`, and an "Extracted by deterministic-pdf-embedded v{N}" footer. No "Advance to extracting" button is visible.

---

### User Story 2 — Scan-only PDF or image is extracted by a vision-capable agent (Priority: P1)

A user uploads `signed-contract-scan.pdf` (3 pages, image-only — no embedded text). The deterministic PDF extractor runs first and reports zero embedded text on every page. The dispatcher then routes to the agent extractor, which calls a vision-capable model under the workspace's extraction policy. The model returns page-by-page transcribed text and a brief structural outline. The object lands in `extracted` with `extractor.kind = "agent"`, `extractor.agentRun.modelId` populated, and `provenance.extraction.modelCallsMade = 3`. The audit row records the model id, prompt fingerprint, and token spend so a governance reviewer can reconstruct exactly what the model saw.

**Why this priority:** The reason agent dispatch exists at all. If the platform cannot extract from scans, it is unfit for any regulated-sector workflow that ingests PDFs of signed paper.

**Independent Test:** Upload an image-only PDF generated by exporting scanned pages. Without intervention, observe the object reach `extracted`. Assert `extraction_output.extractor.kind === "agent"`, `extraction_output.text.length > 0`, `extraction_output.extractor.agentRun.modelId` is the policy-pinned model, and the corresponding `knowledge_extraction_runs` row records `tokenSpend.input > 0` and `tokenSpend.output > 0`.

**Acceptance Scenarios:**

1. **Given** an `application/pdf` object whose deterministic pre-pass reports zero embedded text, **When** the worker enters its dispatch step, **Then** it routes to the agent extractor (`extractors/agent.ts`) using the workspace's policy-pinned vision-capable model.
2. **Given** the agent extractor, **When** it issues a model call, **Then** the call passes through the policy gate; if the gate denies (e.g. `vision_disallowed`, `cost_ceiling_exceeded`), the run fails with that typed reason, the object returns to `imported` with `lastExtractionError` set, and no model call is billed beyond the gate decision.
3. **Given** a successful agent extraction, **When** the run completes, **Then** `extraction_output.extractor.agentRun` carries `{ modelId, promptFingerprint, durationMs, tokenSpend: { input, output, cacheRead?, cacheWrite? }, costUsd, attempts }`.
4. **Given** an audit consumer, **When** it queries `audit_log` for `action = "knowledge.extracted"` on this object, **Then** the metadata row contains the same `modelId`, `promptFingerprint`, and `costUsd` so audit and the row's `extraction_output` cannot drift.

---

### User Story 3 — Failed extraction is recoverable, not terminal (Priority: P2)

A user uploads a corrupt PDF. The deterministic extractor fails to parse the trailer; the agent extractor would have to render the bytes with no usable structure and is too expensive to attempt blindly. The run row transitions to `failed` with a typed error. The object's `state` is reset to `imported` and `lastExtractionError` carries the error code, message, extractor that tried, and timestamp. The detail page shows a red banner — "Extraction failed: deterministic-pdf-embedded reported invalid PDF trailer" — and a Retry button. Clicking Retry enqueues a fresh run.

**Why this priority:** Without this, every failure is a poison pill that strands an object permanently and forces operators to delete and re-upload. P2 because the system can ship without this if the failure rate is low, but it is required for steady-state operation.

**Independent Test:** Upload a deliberately-corrupted PDF. Observe the object park back at `imported` with a non-null `lastExtractionError`. The dashboard row shows a "failed" sub-badge. Click Retry. Observe a second `knowledge_extraction_runs` row at `pending`. After it also fails, the count of runs for that object is 2, and the user can still hit Retry.

**Acceptance Scenarios:**

1. **Given** an object in `extracting` whose extractor throws or returns a typed `extractor_failed`, **When** the worker handles the error, **Then** the run row moves to `failed` with `error = { code, message, extractorKind }`, the object's `state` reverts to `imported`, and `knowledge_objects.lastExtractionError` is populated.
2. **Given** a failed object, **When** the user calls `POST /api/knowledge/objects/:id/retry-extraction`, **Then** a fresh run row is inserted at `pending`, a message is published, and the same dispatch logic runs — the retry is *not* pinned to the previously-failing extractor.
3. **Given** an object whose deterministic extractor failed, **When** the agent extractor is the policy-eligible fallback, **Then** the dispatcher routes to the agent on retry rather than re-running the broken deterministic path.
4. **Given** an object that has failed N times where N exceeds `STATECRAFT_EXTRACT_MAX_AUTO_RETRIES` (default 2), **When** the worker considers auto-retry, **Then** it does NOT auto-retry — only an operator-initiated Retry advances it. This stops a poison message from looping.

---

### User Story 4 — Connector-synced object is extracted on the same path (Priority: P2)

A SharePoint connector sync run lands 47 new knowledge objects in `imported`. Each one is enqueued for extraction by the same `KnowledgeExtractionRequestTopic` the upload path uses. Within minutes, all 47 reach `extracted` (or fail and surface in the dashboard). No connector-specific extraction code path exists — the connector's job ended at "bytes in bucket, row in `imported`".

**Why this priority:** Without this, the connector story (087 Phase 4) lands raw bytes that nobody can use. P2 because connectors themselves are still partly stubs; the wiring must be in place but the load test does not have to run end-to-end before this spec ships.

**Independent Test:** Trigger a SharePoint or upload-connector sync that registers ≥10 new objects. Observe each enqueue an extraction run and reach `extracted` independently. Confirm no connector-specific extraction code exists by grepping the diff (`extractors/dispatch.ts` and `extractionWorker.ts` are the only callers).

**Acceptance Scenarios:**

1. **Given** a connector sync that inserts a `knowledge_objects` row with `state = "imported"`, **When** the sync transaction commits, **Then** the same enqueue helper that `confirmUpload` uses is invoked for each new row.
2. **Given** a connector sync of 100 objects, **When** the worker processes them, **Then** they extract concurrently up to `STATECRAFT_EXTRACT_WORKER_CONCURRENCY` (default 8) and the remainder queue without dropping.
3. **Given** a connector that re-syncs an existing object whose `content_hash` is unchanged, **When** the connector tries to re-enqueue, **Then** the enqueue helper short-circuits (idempotency on `(workspaceId, contentHash, extractorVersion)`) — no duplicate run is created.

---

### Edge Cases

- **Worker crashes mid-extraction.** The run row was `running`, the object was `extracting`. On worker restart, the staleness sweeper (`STATECRAFT_EXTRACT_STALE_AFTER_SEC`, default 600s) flips runs whose `runningAt` is older than the threshold to `failed` with `error.code = "worker_crashed"` and reverts the object to `imported` so a Retry can recover it.
- **Same content uploaded twice.** Two upload requests with identical `content_hash` produce two `knowledge_objects` rows (existing behaviour, deliberately preserved for provenance) but only ONE extraction run — the second enqueue resolves to the first run's id and the second object's `extraction_output` is copied from the first object once that run completes. No second model call.
- **Object deleted while extracting.** The worker MUST detect deletion before writing `extraction_output`. If the object disappears mid-run, the worker writes `status = "abandoned"` to the run row and exits cleanly — no broadcast, no audit-row of `knowledge.extracted`.
- **Policy change between enqueue and run.** The worker re-resolves the policy at run time, not at enqueue time. If a policy that allowed vision is replaced by one that disallows it, the run fails with `policy_denied`, not `extracted` — stale enqueues do not bypass the gate.
- **Mime type misreported by client.** The worker re-sniffs the bytes with a magic-number check before dispatching. If the sniffed type contradicts the declared `mime_type`, the worker uses the sniffed value, logs a `mime_mismatch` warning, and updates `knowledge_objects.mimeType` to the sniffed value. Audit logs the mismatch.
- **Object exceeds size cap for chosen extractor.** Each extractor declares a `maxBytes`. If the object exceeds the deterministic cap but the agent path's cap is also exceeded, the run fails with `object_too_large` and surfaces a remediation tip ("split the document").
- **Agent extractor returns empty text.** A model call that returns `""` after a successful HTTP exchange is treated as `extractor_failed`, not as a successful extraction with empty text. This avoids silently labelling unreadable scans as "extracted, no content."
- **Hash collision on idempotency key.** `(workspaceId, contentHash, extractorVersion)` is the idempotency key. If two genuinely-different objects share the same content hash (impossible without a SHA-256 break, but spec-correct anyway), the first to enqueue wins; subsequent enqueues attach to the same run, since the bytes are identical and the output should be identical.
- **No policy bundle resolved for the workspace.** A workspace whose policy bundle has not yet been compiled (new workspace, race condition) defaults to a built-in *deterministic-only* policy: agent extractors are gated off; objects requiring an agent extractor park at `imported` with `lastExtractionError.code = "policy_pending"`. The policy compiler emitting a real bundle clears the gate; a sweeper retries `policy_pending` objects on bundle commit.
- **Run row written but PubSub publish fails.** Same handling as spec 114 FR-003: mark the run `failed` with `error.code = "enqueue_failed"` so the operator can Retry; do not leave a `pending` row that no worker will ever see.

## 5. Requirements

### 5.1 Functional Requirements

#### Dispatch and worker

- **FR-001**: A new PubSub topic `KnowledgeExtractionRequestTopic` MUST be defined in `api/knowledge/extractionEvents.ts` with `deliveryGuarantee = "at-least-once"` and payload `{ extractionRunId: string }`. It MUST follow the spec 114 `cloneEvents.ts` pattern.
- **FR-002**: A new table `knowledge_extraction_runs` MUST exist with columns `(id UUID PK, knowledge_object_id UUID NOT NULL FK, workspace_id UUID NOT NULL FK, status text NOT NULL, extractor_kind text, extractor_version text, agent_run JSONB, token_spend JSONB, cost_usd NUMERIC, error JSONB, attempts INT NOT NULL DEFAULT 0, queued_at TIMESTAMPTZ NOT NULL DEFAULT now(), running_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, duration_ms INT)`. `status` is one of `pending | running | completed | failed | abandoned`.
- **FR-003**: An `enqueueExtraction({ knowledgeObjectId, workspaceId, reason })` helper in `extractionCore.ts` MUST: (a) compute idempotency key `(workspaceId, contentHash, extractorVersion)` from the object row, (b) if a non-failed run already exists for that key in the last 24h return its id without inserting, (c) otherwise insert a row at `status = "pending"` and publish the topic, (d) if publish fails mark the row `failed` with `error.code = "enqueue_failed"` so retry logic can recover.

  _Load-bearing for spec 143 (amendment, 2026-05-08)._ Spec 143
  FR-010's orphan-imported sweeper Class B path (sweeper-driven
  self-heal vs concurrent user `confirmUpload`) relies on this
  dedup window's non-zero length and SELECT-then-INSERT shape to
  collapse concurrent enqueues to a single extraction run under
  sequential timing. Future amendments to this FR — relaxing the
  24h window, removing the dedup, or replacing it with a strict
  unique-index pattern — MUST update spec 143's race contract
  (`§4.5 / FR-010` concurrency model layer 3) to match. The
  `orphanSweeper.integration.test.ts` race-with-user case in spec
  143 §8 asserts the loose `<= 2 runs` bound deliberately so it
  does not over-couple to FR-003's specific window length.
- **FR-004**: A new subscription `extractionWorker` MUST consume `KnowledgeExtractionRequestTopic`. On message: load the run, CAS-transition `pending → running` and stamp `runningAt`, advance `knowledge_objects.state` to `extracting` (if currently `imported`), invoke the dispatcher, write the typed `extraction_output` on success, advance object state to `extracted`, transition the run to `completed`, audit, and broadcast.
- **FR-005**: The worker MUST be idempotent. A redelivered message whose run is already `running`, `completed`, `failed`, or `abandoned` MUST be a no-op (logged at `info`).
- **FR-006**: A staleness sweeper (`scheduler.ts` cron, every 60s) MUST flip `running` runs whose `runningAt < now() - STATECRAFT_EXTRACT_STALE_AFTER_SEC` (default 600s) to `failed` with `error.code = "worker_crashed"` and revert the object's `state` to `imported`.
- **FR-007**: Worker concurrency MUST be controlled by `STATECRAFT_EXTRACT_WORKER_CONCURRENCY` (default 8). The Encore `Subscription` config exposes the relevant knob (`maxConcurrency`).

#### Enqueue triggers

- **FR-008**: `confirmUpload` (`knowledge.ts:293-367`) MUST call `enqueueExtraction(...)` immediately after the audit row is written. The call MUST be inside the same logical sequence as the audit insert; failure to enqueue MUST NOT roll back the upload (the object is uploaded; extraction can be retried).
- **FR-009**: Connector sync (`scheduler.ts` and `connectors/*` `sync()` paths that insert into `knowledge_objects`) MUST call `enqueueExtraction(...)` for each newly inserted row at `imported`. Re-sync of an unchanged object (same `content_hash`) MUST NOT enqueue a second run.
- **FR-010**: A new endpoint `POST /api/knowledge/objects/:id/retry-extraction` MUST exist with `auth: true`. It MUST verify workspace membership, refuse with `not_failed` if the object's `lastExtractionError` is null, and otherwise call `enqueueExtraction(...)` with `reason = "retry"`. It MUST emit an audit row of action `knowledge.extraction_retry_requested`.

#### Dispatch table

- **FR-011**: A dispatch module `extractors/dispatch.ts` MUST export `pickExtractor({ object, policy }) → { extractorKind, version }` that selects the cheapest extractor whose declared mime-type predicate matches AND whose policy gate passes. Initial table:

| Extractor kind | Predicate | Policy required | Notes |
|---|---|---|---|
| `deterministic-text` | `mime in {text/plain, text/markdown, application/json, text/csv}` | none | `text` is the file body, decoded with detected encoding. |
| `deterministic-pdf-embedded` | `mime == application/pdf` AND embedded-text pre-pass returns ≥ 1 page with text | none | Standard library extraction; agent never invoked. |
| `agent-pdf-vision` | `mime == application/pdf` AND embedded-text pre-pass returns 0 text | `vision_allowed = true` AND cost gate | Vision-capable model rendered per page. |
| `agent-image-vision` | `mime in {image/png, image/jpeg, image/webp, image/heic}` | `vision_allowed = true` AND cost gate | Single-shot vision. |
| `agent-audio-transcription` | `mime in {audio/mpeg, audio/wav, audio/mp4}` | `audio_allowed = true` AND cost gate | Transcription model; emits `text` + `metadata.durationSec`. |
| `deterministic-docx` | `mime == application/vnd.openxmlformats-officedocument.wordprocessingml.document` | none | DOCX parser; agent fallback only on failure. |

- **FR-012**: Adding a new extractor kind MUST be a single new file under `extractors/` plus a new row in the dispatch table — no changes to `extractionWorker.ts` or `extractionCore.ts`.
- **FR-013**: Each extractor MUST declare a `maxBytes` cap. If `knowledge_objects.sizeBytes > maxBytes` for the picked extractor, the dispatcher MUST consider the next eligible extractor; if none qualify, the run fails with `error.code = "object_too_large"`.
- **FR-014**: Before dispatch the worker MUST sniff the file's magic number from the object store (first 4KB) and reconcile against the declared `mime_type`. On mismatch, the sniffed value wins; the worker logs `mime_mismatch`, updates `knowledge_objects.mimeType`, and re-runs `pickExtractor` against the corrected mime.

#### Extractor contract

- **FR-015**: Every extractor MUST implement the same TypeScript interface in `extractors/types.ts`:
  ```ts
  interface Extractor {
    readonly kind: string;
    readonly version: string;
    readonly maxBytes: number;
    canHandle(input: ExtractorInput): boolean;
    extract(input: ExtractorInput, ctx: ExtractorContext): Promise<ExtractionOutput>;
  }
  ```
  `ExtractorContext` carries the workspace policy slice, an Anthropic client (only available to agent extractors), a logger, and a token-spend reporter.
- **FR-016**: `ExtractionOutput` MUST be a typed shape (`extractionOutput.ts`):
  ```ts
  type ExtractionOutput = {
    text: string;
    pages?: Array<{ index: number; text: string; bbox?: unknown }>;
    language?: string;       // ISO 639-1 if detectable
    outline?: Array<{ level: number; text: string; pageIndex?: number }>;
    metadata: Record<string, unknown>;
    extractor: {
      kind: string;
      version: string;
      agentRun?: {
        modelId: string;
        promptFingerprint: string;  // sha256 of the prompt template + key params
        durationMs: number;
        tokenSpend: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
        costUsd: number;
        attempts: number;
      };
    };
  };
  ```
  Drizzle MUST validate this shape at write time; an invalid payload MUST fail the run with `error.code = "extractor_returned_malformed_output"`.

#### Agent governance

- **FR-017**: All agent-kind extractors MUST resolve a workspace policy slice via `policyKernel.resolveExtractionPolicy(workspaceId)` (new helper in `policy-kernel`) before invoking a model. The slice MUST include `{ visionAllowed: boolean, audioAllowed: boolean, modelPin?: string, costCeilingUsdPerCall: number, costCeilingUsdPerDay: number }`.
- **FR-018**: A model call whose pre-flight estimate (input tokens × pinned model rate) exceeds `costCeilingUsdPerCall` MUST be denied at the gate before the HTTP call. Denial MUST return `error.code = "cost_ceiling_exceeded"` with the estimate and ceiling for the audit row.
- **FR-019**: The day-aggregate cost across all extraction runs in a workspace MUST be tracked. A call whose pre-flight estimate would push the running total above `costCeilingUsdPerDay` MUST be denied with `error.code = "daily_cost_exhausted"` and a typed `retryAt` that names the next UTC midnight.
- **FR-020**: Prompt content for agent extractors MUST be assembled from the prompt-assembly cache (spec 070) so prompts are versioned and `promptFingerprint` is reproducible. Inline ad-hoc prompts in extractor source MUST be rejected by lint.
- **FR-021**: The agent extractor MUST NOT call any tool, MUST NOT hold a session, and MUST NOT receive any filesystem or network capability beyond the model HTTP endpoint. A spec 047 policy fixture MUST verify that an extractor invoked with a tool-bearing request fails closed.

#### Failure handling

- **FR-022**: On extractor throw or typed `extractor_failed`, the worker MUST: revert the object's `state` to `imported`, set `knowledge_objects.lastExtractionError = { code, message, extractorKind, attemptedAt }`, mark the run `failed` with that error embedded, and emit `audit_log` action `knowledge.extraction_failed`. No `extraction_output` is written.
- **FR-023**: An object whose `attempts` count for the current `(workspaceId, contentHash, extractorVersion)` key has reached `STATECRAFT_EXTRACT_MAX_AUTO_RETRIES` (default 2) MUST NOT be auto-retried by the worker on a redelivered message. The Retry endpoint (FR-010) is the only path forward.
- **FR-024**: A successful retry that produces `extraction_output` MUST clear `lastExtractionError`. A successful run after failures MUST keep the prior failed run rows for forensic visibility.

#### Schema and audit

- **FR-025**: `knowledge_objects` MUST gain `last_extraction_error JSONB`. Existing rows backfill to `NULL`.
- **FR-026**: `audit_log` MUST gain three new actions: `knowledge.extracted`, `knowledge.extraction_failed`, `knowledge.extraction_retry_requested`. The metadata for `knowledge.extracted` MUST include `extractorKind`, `extractorVersion`, `durationMs`, and (for agent extractors) `modelId`, `promptFingerprint`, `costUsd`.
- **FR-027**: The legacy `transitionState` endpoint (`knowledge.ts:436-501`) MUST be retained but gated: in non-debug mode (`STATECRAFT_EXTRACT_LEGACY_TRANSITION = false`, the default) it MUST refuse with `precondition_failed` code `legacy_transition_disabled`. Operators can flip the env to re-enable for incident response. The legacy path MUST emit an audit row tagged `legacy_path = true` so any use of it shows up in audit reports.
- **FR-028**: The web UI's manual "Advance to {nextState}" button (`web/app/routes/app.project.$projectId.knowledge.$id.tsx:172-184`) MUST be removed in default builds. The same surface MUST render: a status badge, the most recent run's extractor info, and (when failed) a Retry button + the last error code/message. The legacy click-walk MAY remain visible behind `?debug=1`.

#### SDK and broadcast

- **FR-029**: `broadcastToWorkspace` (`api/sync/sync.ts`) MUST emit a `knowledge.object.updated` event with `{ objectId, state, hasExtractionOutput: boolean, lastExtractionError: null | { code } }` on every run-driven state change so the dashboard live-updates without polling.
- **FR-030**: The list and detail endpoints (`listKnowledgeObjects`, `getKnowledgeObject`) MUST include `lastExtractionError` and a denormalised `latestRun: { status, extractorKind, completedAt, durationMs }` in their response shapes so the UI does not need a second round-trip.

### 5.2 Key Entities

- **`knowledge_objects`** (existing, extended): gains `last_extraction_error JSONB`. The `extraction_output` column becomes a typed contract (FR-016) — its shape is enforced at write time, not the schema.
- **`knowledge_extraction_runs`** (new): one row per attempt. Idempotency key `(workspaceId, contentHash, extractorVersion)`. Powers retry, audit, and the staleness sweeper.
- **`audit_log`** (existing, extended): gains `knowledge.extracted`, `knowledge.extraction_failed`, `knowledge.extraction_retry_requested` actions.
- **`KnowledgeExtractionRequestTopic`** (new): PubSub channel between the enqueue helper and the worker subscription.
- **Workspace policy slice** (resolved, not stored here): `{ visionAllowed, audioAllowed, modelPin, costCeilingUsdPerCall, costCeilingUsdPerDay }`. Sourced from the compiled policy bundle (spec 047) at run time.

### 5.3 Permissions and audit

- Enqueue from `confirmUpload` and connector sync inherits the caller's existing membership check; no new permission.
- Retry endpoint requires the same `workspace:knowledge.read` membership as the existing transition endpoint.
- The legacy `transitionState` endpoint, when re-enabled for incident response, requires `org:admin` (it bypasses the pipeline; only org admins should hold that key).
- Every extraction run produces exactly one terminal audit row (`knowledge.extracted` OR `knowledge.extraction_failed`). Runs that are abandoned (object deleted mid-run) emit no audit row.

### 5.4 Out-of-process operations

- Agent extractors call the Anthropic API directly via the `@anthropic-ai/sdk` (already a statecraft dependency). They MUST use prompt caching for system prompts (the per-extractor instruction block) so high-volume workspaces benefit from cache hits.
- Deterministic PDF extraction uses `pdf-parse` (or equivalent — implementation choice, not a spec constraint). DOCX uses `mammoth` or equivalent. The spec does not pin the library.
- Magic-number sniffing reads the first 4KB of the S3 object via `headObject` + a ranged GET. The full object is *not* downloaded for sniffing.

## 6. Success Criteria

### Measurable Outcomes

- **SC-001**: For 100 randomly selected uploads of mixed file types (PDF embedded-text, PDF scan, plain text, markdown, DOCX, PNG, MP3) with default workspace policy enabled, ≥95% reach `extracted` end-to-end without operator intervention. The remaining ≤5% are surfaced with a typed `lastExtractionError`.
- **SC-002**: A 1 MB embedded-text PDF reaches `extracted` from `confirmUpload` in under 5s p50 / 15s p95 on a developer machine. A 10 MB scan PDF reaches `extracted` (via agent vision) in under 60s p95 with the default model pin.
- **SC-003**: Zero objects sit at `imported` for more than 30s after `confirmUpload` succeeds, *unless* `lastExtractionError` is non-null or the workspace policy denies the required extractor (verified by a soak test seeding 50 uploads and asserting state distribution at t=30s).
- **SC-004**: Every `extracted` object has a non-null `extraction_output.text`, a non-null `extraction_output.extractor.kind`, and (for agent extractors) a non-null `extraction_output.extractor.agentRun.modelId`. A unit test runs over a fixture set covering all extractor kinds.
- **SC-005**: A workspace policy that sets `visionAllowed = false` causes 100% of image-only PDF uploads to park at `imported` with `lastExtractionError.code = "policy_denied"` and ZERO outbound model calls, verified by a fake Anthropic transport asserting call count.
- **SC-006**: A workspace policy with `costCeilingUsdPerDay = 0.50` blocks the (n+1)th call once the day-aggregate exceeds $0.50, with `error.code = "daily_cost_exhausted"`. The daily counter resets at UTC midnight.
- **SC-007**: A worker process killed mid-run causes the corresponding object to recover to a Retry-ready state within `STATECRAFT_EXTRACT_STALE_AFTER_SEC + 60s` (default 660s). No object is permanently stranded by a single worker crash.
- **SC-008**: The legacy `transitionState` endpoint, when called in default-config builds, returns `precondition_failed` with `legacy_transition_disabled` 100% of the time. A regression test asserts this.
- **SC-009**: Objects with identical `content_hash` uploaded back-to-back trigger exactly one model call across both, verified by a fake Anthropic transport asserting call count.
- **SC-010**: A poisoned object (extractor throws on every attempt) does not auto-retry beyond `STATECRAFT_EXTRACT_MAX_AUTO_RETRIES` (default 2). The third+ messages are no-ops. The Retry endpoint still works.

## 7. Open Decisions

- **Should extraction live in statecraft, or be brokered to OPC?** Spec 087 §3.2 says the web plane "does not execute Claude Code sessions." This spec interprets that as a prohibition on stateful, tool-bearing, code-modifying agent sessions — not on one-shot model calls that read bytes and emit text. If governance treats *any* model call as desktop-only, the worker becomes a broker that publishes work for OPC instances to claim. The trade is: in-statecraft extraction is operationally simpler and works without an online desktop; OPC-side extraction is architecturally purer but requires at least one online OPC per workspace. **Recommended:** in-statecraft for v1; revisit if the §3.2 boundary tightens.
- **Classification stage scope.** Whether `extracted → classified → available` is a separate spec or an extension here. Recommendation: separate spec, because classification taxonomy is governance-shaped (which categories matter for which factory adapters?) and pulling it into 115 inflates the surface area.
- **Per-page partial success.** A 200-page PDF where 3 pages fail OCR — should the run be `completed` with a `metadata.failedPages` field, or `failed`? V1 chooses `completed` if ≥80% of pages produced text, `failed` otherwise. The threshold is configurable.
- **Re-extraction on extractor version bump.** When an extractor's `version` advances, existing extracted objects are stale. Should the system auto-enqueue them? V1: no — operators trigger backfill explicitly. A backfill endpoint may live in a follow-up spec.
- **Streaming partial output to the dashboard.** The `broadcastToWorkspace` message currently signals state changes only. A future iteration could stream partial extracted text as the agent emits tokens. Not in scope.
- **Cost-ceiling backpressure for connector floods.** If a SharePoint sync drops 5,000 image-only PDFs into the queue, the daily cost ceiling will trip mid-batch and the rest park at `policy_denied`. V1 accepts this and surfaces the count; a future spec might add a connector-side budget pre-check.

## 8. Provenance

- `platform/services/statecraft/api/db/migrations/10_create_knowledge_intake.up.sql:16-58` — current `knowledge_object_state` enum and `knowledge_objects` schema (this spec adds a column and a new table).
- `platform/services/statecraft/api/knowledge/knowledge.ts:422-501` — current click-walk `transitionState` endpoint (this spec gates it behind a debug env).
- `platform/services/statecraft/api/knowledge/knowledge.ts:293-367` — `confirmUpload`; this spec adds an `enqueueExtraction` call after the audit insert.
- `platform/services/statecraft/api/knowledge/scheduler.ts` — connector sync orchestrator; this spec adds enqueue hooks on new-row insertion.
- `platform/services/statecraft/api/projects/cloneEvents.ts` and `cloneWorker.ts` — pattern reused verbatim for the extraction Topic + Subscription (spec 114).
- `platform/services/statecraft/web/app/routes/app.project.$projectId.knowledge.$id.tsx:172-184` — the manual "Advance to {nextState}" button this spec removes.
- Spec 087 §4.3 and §8 Phase 2 — the unimplemented extraction stage this spec delivers.
- Spec 036 — safety-tier governance; agent extractors register at the appropriate tier.
- Spec 047 — governance control plane; provides the policy slice resolution.
- Spec 070 — prompt-assembly cache; provides versioned, fingerprintable prompts for the agent extractor.
