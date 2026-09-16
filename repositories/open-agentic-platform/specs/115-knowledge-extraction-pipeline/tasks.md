# Tasks: Knowledge Extraction Pipeline

**Input**: `/specs/115-knowledge-extraction-pipeline/`
**Prerequisites**: spec.md, plan.md
**Stories**: US-1 (Auto-extract on upload, P1), US-2 (Agent extraction for scans/images/audio, P1), US-3 (Failure recovery + Retry, P2), US-4 (Connector sync drives same path, P2)

Tasks are grouped by phase per `plan.md`. `[P]` = can run in parallel with other `[P]` tasks in the same phase. `[USx]` = which user story.

---

## Phase 0 — Foundations (all stories)

Schema, types, and audit actions. Blocks every later phase.

- [ ] **T001** Add migration `platform/services/statecraft/api/db/migrations/NN_add_extraction_runs.up.sql`: create `knowledge_extraction_runs` table per FR-002 (`id`, `knowledge_object_id` FK CASCADE, `workspace_id` FK, `status text NOT NULL CHECK status IN (...)`, `extractor_kind`, `extractor_version`, `agent_run JSONB`, `token_spend JSONB`, `cost_usd NUMERIC(10,6)`, `error JSONB`, `attempts INT NOT NULL DEFAULT 0`, four timestamps, `duration_ms INT`). Indexes on `(workspace_id, status)`, `(knowledge_object_id, queued_at DESC)`, `(workspace_id, completed_at DESC)` for the day-aggregate cost query.
- [ ] **T002** In the same migration, `ALTER TABLE knowledge_objects ADD COLUMN last_extraction_error JSONB`. Existing rows backfill to NULL.
- [ ] **T003** [P] Update `api/db/schema.ts` Drizzle schema with `knowledgeExtractionRuns` table and the new `lastExtractionError` column on `knowledgeObjects`. Export both.
- [ ] **T004** [P] Create `api/knowledge/extractionOutput.ts`: export `ExtractionOutput` TypeScript type matching FR-016 verbatim, plus a Zod schema `extractionOutputSchema` validating it. Export `validateExtractionOutput(value): ExtractionOutput` that throws a typed `ExtractorReturnedMalformedOutputError` on parse failure.
- [ ] **T005** [P] Create `api/knowledge/extractors/types.ts`: export `Extractor` interface per FR-015 (`kind`, `version`, `maxBytes`, `canHandle`, `extract`), `ExtractorInput` (object row + presigned download URL or buffer), `ExtractorContext` (workspace policy slice, optional Anthropic client, logger, token-spend reporter).
- [ ] **T006** [P] Add the three new audit actions to wherever audit actions are constrained (`api/db/schema.ts` or audit-action enum module): `knowledge.extracted`, `knowledge.extraction_failed`, `knowledge.extraction_retry_requested`.
- [ ] **T007** [P] Create `api/knowledge/extractionPolicy.ts`: export `ExtractionPolicy` type (`{ visionAllowed, audioAllowed, modelPin?, costCeilingUsdPerCall, costCeilingUsdPerDay }`) and `DEFAULT_DETERMINISTIC_ONLY_POLICY` constant for the brand-new-workspace fallback per spec §4 edge cases. The real `resolveExtractionPolicy` is wired in Phase 2.

**Checkpoint:** `npm run build` in statecraft passes; migration applies cleanly to a fresh DB; schema exports compile against existing callers.

---

## Phase 1a — Spine: Topic + Subscription + sweeper (US-1, US-2, US-3, US-4)

The worker can claim and CAS run rows; extractors are wired in 1b. Worker is a no-op stub that fails closed with `extractor_not_implemented` until 1b lands.

- [ ] **T010** Create `api/knowledge/extractionEvents.ts` mirroring `api/projects/cloneEvents.ts`: export `KnowledgeExtractionRequestTopic = new Topic<{ extractionRunId: string }>("knowledge-extraction-request", { deliveryGuarantee: "at-least-once" })`.
- [ ] **T011** Create `api/knowledge/extractionCore.ts`: export `enqueueExtraction({ knowledgeObjectId, workspaceId, reason })` per FR-003 — load object row to get `contentHash`, derive `extractorVersion` from `pickExtractor(object, defaultPolicy).version` for the idempotency key, dedupe against existing non-failed runs in last 24h, insert `pending` row, publish topic, on publish failure mark run `failed` with `error.code = "enqueue_failed"`. Return the run id.
- [ ] **T012** In `extractionCore.ts` add `runExtractionWork({ extractionRunId })` per FR-004: load run + object, CAS `pending → running` stamping `runningAt`, advance object to `extracting`, call `pickExtractor(object, policy)`, invoke its `extract()`, validate output via `validateExtractionOutput`, in a transaction `SELECT … FOR UPDATE` the object row (abandon if gone — FR per §4 edge case), write `extraction_output`, advance object to `extracted`, transition run to `completed`, audit `knowledge.extracted`, broadcast.
- [ ] **T013** In `extractionCore.ts` add `markRunFailed({ runId, error })` per FR-022: revert object `state` to `imported`, write `lastExtractionError = { code, message, extractorKind, attemptedAt }`, transition run `failed`, audit `knowledge.extraction_failed`. Auto-retry-cap check (FR-023): if `attempts ≥ STATECRAFT_EXTRACT_MAX_AUTO_RETRIES` (default 2), mark run `failed` and do NOT redeliver — log at `info`.
- [ ] **T014** Create `api/knowledge/extractionWorker.ts`: `new Subscription(KnowledgeExtractionRequestTopic, "extraction-worker", { handler: runExtractionWork, maxConcurrency: env.statecraft_EXTRACT_WORKER_CONCURRENCY ?? 8 })`. Idempotency on redelivery (FR-005) — if run is already `running|completed|failed|abandoned`, no-op with `info` log.
- [ ] **T015** [P] In `api/knowledge/scheduler.ts` add a 60s cron `extractionStalenessSweeper` per FR-006: SELECT runs where `status = 'running' AND running_at < now() - interval (STATECRAFT_EXTRACT_STALE_AFTER_SEC seconds, default 600)`, transition each to `failed` with `error.code = "worker_crashed"`, revert the corresponding object to `imported` if still `extracting`.
- [ ] **T016** [P] In `api/sync/sync.ts` (or wherever `broadcastToWorkspace` is defined), add a `knowledge.object.updated` event shape per FR-029: `{ objectId, state, hasExtractionOutput, lastExtractionError: null | { code } }`. Emit from the success and failure paths in `extractionCore.ts`.
- [ ] **T017** [P] Test `extractionCore.test.ts`: CAS-redelivery no-op (run already `running` — second message exits cleanly without double-extracting).
- [ ] **T018** [P] Test `extractionCore.test.ts`: sweeper recovers a stale `running` row — set `runningAt = now() - 700s`, run sweeper, assert run is `failed` and object reverted to `imported`.

**Checkpoint:** Publish a manual message to `KnowledgeExtractionRequestTopic` for a fake run id and observe the worker CAS, the (stub) extractor throw, the run land in `failed`, the object revert to `imported` with `lastExtractionError` set. End-to-end spine works without real extractors.

---

## Phase 1b — Deterministic extractors (US-1)

Plain text, markdown, JSON, embedded-text PDF, DOCX. Agent never invoked.

- [ ] **T020** Create `api/knowledge/extractors/dispatch.ts` per FR-011 + FR-014: export `pickExtractor({ object, policy })` returning `{ extractor: Extractor, kind, version }`. The dispatch table starts with the four deterministic kinds; agent kinds are added in Phase 2 as gated registrations.
- [ ] **T021** Create `api/knowledge/storage.ts` helper `sniffMimeType(bucket, storageKey, declaredMime, sizeBytes) → string` per FR-014: skip when `sizeBytes < 4096` (return declared); otherwise ranged GET first 4KB, magic-number check, log `mime_mismatch` on disagreement, return sniffed value.
- [ ] **T022** [P] Create `api/knowledge/extractors/deterministic-text.ts`: handles `text/plain`, `text/markdown`, `application/json`, `text/csv`. Decode with detected encoding, populate `text` and `metadata.lineCount`. `version = "1"`.
- [ ] **T023** [P] Create `api/knowledge/extractors/deterministic-pdf-embedded.ts`: use `pdf-parse` (or equivalent) to extract per-page text. Populate `text` (joined), `pages[]`, `outline[]` (from PDF outline if present), `language` (heuristic), `metadata.pageCount`. Per FR plan-decision: if median per-page text length < `EMBEDDED_TEXT_MIN_MEDIAN_CHARS` (default 80), `canHandle` returns false so dispatcher falls through to agent path. `version = "1"`.
- [ ] **T024** [P] Create `api/knowledge/extractors/deterministic-docx.ts`: use `mammoth` (or equivalent) to extract text + outline from DOCX. Populate `text`, `outline[]` from heading runs, `metadata.wordCount`. `version = "1"`.
- [ ] **T025** Wire all three deterministic extractors into the dispatch table from T020. Each declares its `maxBytes` (text 50MB, PDF 200MB, DOCX 100MB — tunable via env).
- [ ] **T026** [P] Update `listKnowledgeObjects` and `getKnowledgeObject` (`api/knowledge/knowledge.ts:130-198`) to also return `lastExtractionError` and a denormalised `latestRun: { status, extractorKind, completedAt, durationMs }` per FR-030. Add a single JOIN against `knowledge_extraction_runs` ordered by `completed_at DESC LIMIT 1`.
- [ ] **T027** [P] Test `extractors/deterministic-text.test.ts`: feed plain text → assert `extractor.kind === "deterministic-text"`, `text` matches, no agent fields.
- [ ] **T028** [P] Test `extractors/deterministic-pdf-embedded.test.ts`: feed an embedded-text PDF fixture → assert `pages.length`, non-empty `text`, `outline` populated. Feed a fixture whose median per-page text is below threshold → assert `canHandle === false`.
- [ ] **T029** [P] Test `extractors/dispatch.test.ts`: a `text/plain` object with default policy resolves to `deterministic-text`; an `image/png` with default-deterministic-only policy resolves to NO extractor (run will fail with `policy_pending`).

**Checkpoint:** `runExtractionWork` over a real text/PDF/DOCX object produces a typed `extraction_output` and the object lands in `extracted` with no agent invocation.

---

## Phase 1c — Trigger wiring + retry endpoint (US-1, US-3, US-4)

Connect the spine to upload-confirm and connector sync; expose Retry.

- [ ] **T030** In `api/knowledge/knowledge.ts` `confirmUpload` (`:293-367`), after the existing `auditLog` insert add `await enqueueExtraction({ knowledgeObjectId: req.id, workspaceId: auth.workspaceId, reason: "upload_confirmed" })`. Wrap in a try/catch that logs but does not roll back the upload (FR-008).
- [ ] **T031** In `api/knowledge/scheduler.ts` connector sync orchestrator — for each `SyncedObject` whose insert results in a new `knowledge_objects` row at `imported`, call `enqueueExtraction(...)` (FR-009). Re-sync hitting same `content_hash` MUST short-circuit per FR-003 idempotency.
- [ ] **T032** [P] In `api/knowledge/knowledge.ts` add `retryExtraction` endpoint per FR-010: `POST /api/knowledge/objects/:id/retry-extraction`. Verify workspace membership, refuse with `not_failed` if `lastExtractionError` is null, otherwise call `enqueueExtraction({ … reason: "retry" })`, audit `knowledge.extraction_retry_requested`. Return `{ runId }`.
- [ ] **T033** [P] In `api/knowledge/knowledge.ts` `transitionState` (`:436-501`), add the FR-027 env gate: if `process.env.statecraft_EXTRACT_LEGACY_TRANSITION !== "true"`, throw `APIError.failedPrecondition("legacy_transition_disabled", "use POST /retry-extraction or rely on the automatic pipeline")`. Audit any successful legacy call with `metadata.legacy_path = true`.
- [ ] **T034** [P] Test `confirmUpload.test.ts`: confirm a fresh upload → assert one `knowledge_extraction_runs` row at `pending` with the right object id.
- [ ] **T035** [P] Test `retryExtraction.test.ts`: an object with `lastExtractionError` set → POST to retry endpoint → assert new run created, audit row written, response carries `runId`. An object with `lastExtractionError = null` → assert `not_failed` error.
- [ ] **T036** [P] Test idempotency: insert two `knowledge_objects` rows with identical `content_hash`, call `enqueueExtraction` for each → assert one run, second enqueue resolves to first run id (FR-003 + §4 "same content uploaded twice").

**Checkpoint:** A user uploads a small markdown file; without any further click, within 5s the dashboard list shows it at `extracted` with `latestRun.extractorKind = "deterministic-text"`. SC-002 first half passes.

---

## Phase 2 — Agent extractors + governance (US-2)

Vision PDF, vision image, audio transcription. Policy-gated, cost-capped.

- [ ] **T040** In `crates/policy-kernel`, add `resolveExtractionPolicy(workspaceId: &str) -> ExtractionPolicy`. Reads the compiled policy bundle slice. If no bundle is yet compiled for the workspace, return `DEFAULT_DETERMINISTIC_ONLY_POLICY` (vision off, audio off, $0 ceilings) and an error-shaped reason `"policy_pending"`.
- [ ] **T041** Expose the resolver to statecraft. Either: (a) HTTP shim in statecraft hitting a small Rust binary, or (b) static JSON snapshot read by statecraft directly from `.derived/policy/`. Decision: ship (b) for MVP — the policy compiler emits `.derived/policy/workspaces/{workspaceId}.json`; statecraft reads with a 30s in-memory cache. Update `extractionPolicy.ts` from Phase 0 to source from this file with the `DEFAULT_DETERMINISTIC_ONLY_POLICY` fallback when the file is missing.
- [ ] **T042** Wire the prompt-assembly cache (spec 070, `product/packages/prompt-assembly`) into the agent extractors. Each agent extractor calls `assembledPrompts.get("knowledge-extract.{kind}", { params })` which returns `{ prompt: string, fingerprint: string }`. Add a lint rule (eslint custom or grep-based pre-commit) that rejects inline string-literal prompts in `extractors/agent-*.ts` (FR-020).
- [ ] **T043** Create `api/knowledge/extractors/agent.ts` shared base: pre-flight cost gate per FR-018 (estimate input tokens × pinned model rate; deny `cost_ceiling_exceeded` if over per-call ceiling); day-aggregate gate per FR-019 (`SELECT COALESCE(SUM(cost_usd), 0) FROM knowledge_extraction_runs WHERE workspace_id = ? AND completed_at >= today_utc_midnight`; deny `daily_cost_exhausted` with `retryAt` if (estimate + sum) > day ceiling); make Anthropic call with prompt caching enabled on system prompt; populate `agentRun` in output.
- [ ] **T044** [P] Create `api/knowledge/extractors/agent-pdf-vision.ts`: predicate per dispatch table (mime PDF AND embedded-text pre-pass said no). Renders pages to images at the worker (or sends PDF directly per Anthropic's PDF support — pick whichever the SDK supports cleanly), one model call per page with caching of the system prompt. Aggregates per-page text into `pages[]`. `version = "1"`.
- [ ] **T045** [P] Create `api/knowledge/extractors/agent-image-vision.ts`: single-shot vision call. Populates `text`, `metadata.imageDimensions`. `version = "1"`.
- [ ] **T046** [P] Create `api/knowledge/extractors/agent-audio-transcription.ts`: transcription model call. Populates `text`, `metadata.durationSec`. `version = "1"`. (If no Anthropic transcription endpoint, mark this extractor as `unimplemented` for now and keep the row in dispatch — audio objects will park at `imported` until a transcription path lands.)
- [ ] **T047** Wire all three agent extractors into `dispatch.ts` from T020 with the policy-gated predicates. Their `canHandle` returns true only when policy permits and the deterministic predecessor declined.
- [ ] **T048** [P] Dedicated Anthropic client per worker subscription with bounded pool sized to `STATECRAFT_EXTRACT_WORKER_CONCURRENCY` to avoid pool starvation against the existing statecraft-wide client.
- [ ] **T049** [P] Test `extractors/agent.test.ts`: stub Anthropic transport. Policy with `visionAllowed = false` + image upload → assert `lastExtractionError.code = "policy_denied"`, transport call count = 0 (SC-005).
- [ ] **T050** [P] Test cost ceilings: per-call estimate over ceiling → `cost_ceiling_exceeded`, transport not called. Day-aggregate seeded near ceiling → next call denied with `daily_cost_exhausted` and a `retryAt` at next UTC midnight (SC-006).
- [ ] **T051** [P] Test prompt fingerprint reproducibility: two runs of the same extractor on the same input produce identical `promptFingerprint`. Inline-prompt lint rule rejects a test fixture that introduces a string literal in `agent-pdf-vision.ts`.
- [ ] **T052** [P] Test tool-bearing fail-closed (FR-021): construct an `ExtractorContext` whose `anthropicClient` is invoked with a tool definition → assert the call is rejected before HTTP and run lands in `failed` with a typed reason. Pulls a fixture from spec 047's policy-bundle test harness.

**Checkpoint:** A scan-only PDF upload reaches `extracted` with `extractor.kind = "agent-pdf-vision"`, populated `agentRun`, and the audit row carries `modelId` + `promptFingerprint` + `costUsd`. SC-001, SC-002 second half pass.

---

## Phase 3 — UX (US-1, US-3)

Remove the manual click-walk; add status badge + Retry; live updates.

- [ ] **T060** In `web/app/routes/app.project.$projectId.knowledge.$id.tsx` (lines `~172-184`), remove the "Advance to {nextState}" button in default builds. Behind `useSearchParams().get("debug") === "1"`, keep the legacy click-walk visible (FR-028).
- [ ] **T061** On the same detail page, render a status badge sourced from `latestRun.status` + the object's `state`. Add an extractor footer ("Extracted by `{extractor.kind}` v`{extractor.version}` in `{durationMs}` ms"). For agent-extracted objects, also surface `agentRun.modelId` and `costUsd`.
- [ ] **T062** When `lastExtractionError !== null`, render a red banner at the top with the error `code` and `message`, and a Retry button that calls `POST /api/knowledge/objects/:id/retry-extraction`. On success, update local state to `state = "extracting"` optimistically; the WebSocket broadcast will reconcile.
- [ ] **T063** [P] In `web/app/routes/app.project.$projectId.knowledge.tsx` (list view), surface the `latestRun.extractorKind` and a small failure indicator on rows where `lastExtractionError !== null`. Live-update the list via the `knowledge.object.updated` broadcast wired in T016.
- [ ] **T064** [P] Wire the broadcast subscription in the web client. The existing workspace WebSocket channel from `api/sync/sync.ts` already streams events; add a handler for `knowledge.object.updated` that refreshes the listing row by id and updates the detail page if open.
- [ ] **T065** [P] UI test: open a fresh object's detail page → assert no "Advance to extracting" button visible. Append `?debug=1` → assert the legacy click-walk reappears.
- [ ] **T066** [P] UI test: simulate a `knowledge.object.updated` event with `lastExtractionError = { code: "extractor_failed" }` → assert red banner renders with the error code and a Retry button. Click Retry → assert POST hit and banner clears optimistically.
- [ ] **T067** [P] UI test: list view with two objects, one fresh and one failed → assert failure indicator only on the failed row; receive a state-change broadcast for the fresh one → assert the row updates without a manual refresh.

**Checkpoint:** Default-build users never see the manual transition button; failed objects expose Retry; the dashboard reflects state changes live without polling.

---

## Phase 4 — Verification

- [ ] **T070** Build a fixture pack at `api/knowledge/__fixtures__/`: small embedded-text PDF, image-only PDF (3 pages), `hello.md`, `data.json`, `report.docx`, `chart.png`, `voicenote.mp3` (skip MP3 if T046 stayed unimplemented). Each fixture has a paired `*.expected.json` with the expected `text`, `pages.length`, `extractor.kind`, `language`. Add a single fixture-driven test in `extractionCore.test.ts` that runs every fixture end-to-end through `runExtractionWork`.
- [ ] **T071** Soak test `extractionCore.soak.test.ts`: seed 50 mixed uploads via `enqueueExtraction`, run the worker subscription, assert at t=30s the state distribution matches FR / SC expectations (zero objects at `imported` unless `lastExtractionError !== null`). SC-003.
- [ ] **T072** Worker-crash recovery test: start a run, kill the worker process before completion (or simulate via `process.exit(1)` inside a stub extractor), restart, run sweeper after `STATECRAFT_EXTRACT_STALE_AFTER_SEC + 60s`, assert run is `failed` with `worker_crashed` and object reverted. SC-007.
- [ ] **T073** Auto-retry cap regression: poison object whose extractor always throws → assert exactly `STATECRAFT_EXTRACT_MAX_AUTO_RETRIES + 1` failed run rows total (the initial enqueue plus N auto-retries — actually re-read FR-023: cap is on auto-retry count for redelivered messages; initial run counts; so default = up to 2 attempts), then redeliveries are no-ops. Calling the Retry endpoint creates a fresh run regardless. SC-010.
- [ ] **T074** [P] Legacy-path-disabled regression test: with `STATECRAFT_EXTRACT_LEGACY_TRANSITION` unset, POST to `/api/knowledge/objects/:id/transition` → assert `precondition_failed/legacy_transition_disabled`. With env set to `"true"`, same call succeeds and audit row carries `metadata.legacy_path = true`. SC-008.
- [ ] **T075** [P] Run `make ci` locally; fix any lint, typecheck, or test breakage from new files.
- [ ] **T076** Update `platform/services/statecraft/CLAUDE.md`: add a "Knowledge extraction pipeline" section under the existing intake docs describing the Topic + worker + dispatch shape and pointing at the four entry points (`enqueueExtraction`, `runExtractionWork`, `pickExtractor`, `retryExtraction`).
- [ ] **T077** Flip spec frontmatter `implementation: pending → complete`; recompile registry (`tools/spec-spine/spec-compiler/target/release/spec-compiler compile`) and structural index (`tools/spec-spine/codebase-indexer/target/release/codebase-indexer compile`) so traceability picks up the new files.

---

## Dependencies & parallel opportunities

- **Phase 0** blocks every later phase. T003–T007 are all `[P]` once T001+T002 land.
- **Phase 1a** depends on 0; nothing else blocks it. Worker can land as a no-op stub before extractors exist.
- **Phase 1b** depends on 1a's `Extractor` interface and `runExtractionWork` integration point. Each deterministic extractor (T022–T024) is `[P]`.
- **Phase 1c** depends on 1a's `enqueueExtraction` helper. T030 (confirmUpload), T031 (connector hooks), T032 (retry endpoint), T033 (legacy gate) all touch different files and run `[P]` after T011 lands.
- **Phase 2** depends on 1b's dispatcher contract. T040+T041 (policy resolver) gate T043+T044+T045+T046 (extractors). T042 (prompt cache) is `[P]` with the policy work. Tests T049–T052 are all `[P]`.
- **Phase 3** depends on 1c's broadcast event shape and the retry endpoint shape. T063–T067 are all `[P]`.
- **Phase 4** runs last; T074 + T075 are `[P]` with each other.

## Notes

- Each task should land as one or two commits keeping the diff under the 500-line `CONST-004` warn threshold where practical.
- Tests live next to the file they cover (`extractionCore.test.ts` next to `extractionCore.ts`), matching the existing `clone.test.ts`, `import.test.ts` pattern.
- The migration in T001+T002 is a single up.sql file with a paired down.sql per existing convention.
- `DEFAULT_DETERMINISTIC_ONLY_POLICY` is the safety net: any workspace whose policy bundle has not yet compiled gets it implicitly. Audit reviewers should be able to identify its use by `extractionPolicy.source = "default_fallback"` in the agent-run audit metadata.
- Cost numerics use `NUMERIC(10,6)` to keep sub-cent precision (Anthropic prices are quoted per million tokens; rounding at six decimal places preserves accuracy without overflow concerns).
- Audit row metadata is the surface governance reads; keep the field set in T012 (`knowledge.extracted` audit) stable across renames so dashboards don't break.
