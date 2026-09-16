# Implementation Plan: Knowledge Extraction Pipeline

**Spec**: [spec.md](./spec.md)
**Feature**: `115-knowledge-extraction-pipeline`
**Date**: 2026-04-27
**Branch**: `115-knowledge-extraction-pipeline`

## Summary

Replace the manual click-walk on `imported → extracting → extracted` (`knowledge.ts:436-501`) with an automatic, agent-aware pipeline. A new `KnowledgeExtractionRequestTopic` is published by `confirmUpload` and connector sync; an `extractionWorker` subscription claims a `knowledge_extraction_runs` row, picks an extractor by mime type from a dispatch table, runs it, writes a typed `extraction_output`, and broadcasts a state-change event back to the dashboard. Deterministic extractors handle text, markdown, JSON, embedded-text PDFs, and DOCX; agent extractors (Claude vision/audio under workspace policy) handle image-only PDFs, images, and audio. Failures park the object back at `imported` with a typed `last_extraction_error` and a Retry endpoint. The dashboard's manual "Advance to {nextState}" button is removed in default builds; the legacy endpoint stays gated behind an env flag for incident response. The whole shape mirrors the spec 114 clone pipeline (Topic + Subscription + run-row + staleness sweeper) — that pattern is the load-bearing reuse here.

## Sequencing

| Phase | Focus | Story |
|-------|-------|-------|
| **0**  | Foundations: migration adds `knowledge_extraction_runs` + `knowledge_objects.last_extraction_error` + 3 new `audit_log` actions; typed `ExtractionOutput` and `Extractor` interface modules | all |
| **1a** | Spine: `extractionEvents.ts` topic + `extractionWorker.ts` subscription with CAS run-row transitions + staleness sweeper cron in `scheduler.ts` (worker is a no-op while extractors land) | US-1, US-2 |
| **1b** | Deterministic extractors: `extractors/deterministic-text.ts`, `deterministic-pdf-embedded.ts`, `deterministic-docx.ts` + dispatcher + magic-number sniff helper | US-1 |
| **1c** | Trigger wiring: `enqueueExtraction` helper, hook in `confirmUpload`, hooks in connector `sync()` paths, retry endpoint `POST /api/knowledge/objects/:id/retry-extraction` | US-1, US-3, US-4 |
| **2**  | Agent extractors: `policy-kernel` exposes `resolveExtractionPolicy`; `extractors/agent-pdf-vision.ts`, `agent-image-vision.ts`, `agent-audio-transcription.ts`; per-call + per-day cost gates; prompts sourced from spec 070 cache | US-2 |
| **3**  | UX: remove "Advance to {nextState}" button (default build); add status badge + last-error banner + Retry button + extractor footer on detail page; live update via `broadcastToWorkspace`; gate legacy `transitionState` behind `STATECRAFT_EXTRACT_LEGACY_TRANSITION` env | US-1, US-3 |
| **4**  | Verification: fixture pack across mime types; soak test of 50 uploads; cost-ceiling regression; worker-crash recovery test; legacy-path-disabled regression; idempotency/duplicate-content test | all |

Phase 1a unblocks 1b and 1c in parallel — once the worker subscription is loading rows and CASing them, the extractor implementations can land independently behind a feature dispatch that throws `not_implemented` (failing closed via the existing FR-022 path). Phase 2 needs Phase 1b's dispatcher contract to be stable. Phase 3 needs Phase 1c's broadcast + endpoint shape.

## Approach decisions

- **Statecraft owns extraction; not brokered to OPC.** Spec 087 §3.2's "web does not execute Claude Code sessions" is read narrowly: it forbids stateful, tool-bearing, code-modifying agent sessions, not one-shot model calls that read bytes and emit text. Brokering to OPC would require at least one online desktop per workspace and a claim/lease protocol — substantial new surface for no governance gain over a properly-gated server-side call. Revisit only if the §3.2 boundary is later tightened.
- **Reuse the spec 114 pattern verbatim.** `Topic + Subscription + run-row + CAS + staleness sweeper` is already production-shaped in `cloneEvents.ts` / `cloneWorker.ts` / `cloneCore.ts`. Copying that shape (down to file naming) keeps the operator mental model — and the ops dashboards — consistent. We do not invent a new queue.
- **Idempotency key = `(workspaceId, contentHash, extractorVersion)`.** Uploading the same bytes twice produces two `knowledge_objects` rows but one extraction run; identical bytes will always produce identical output, so a second model call is waste. The second object copies its sibling's `extraction_output` once the run completes.
- **Per-extractor `maxBytes`, not a global cap.** A 200 MB DOCX is a different problem than a 200 MB scan PDF (cost-wise). Each extractor declares its own ceiling; the dispatcher considers the next eligible extractor on cap miss before failing.
- **Mime sniff before dispatch.** First 4KB of the S3 object via ranged GET, magic-number check against the declared `mime_type`. Sniffed value wins on disagreement — clients lie, and routing a `image/jpeg-actually-html` to the vision model would burn tokens for nothing. We skip the sniff (trust the declared type) when `sizeBytes < 4096`.
- **Prompts come from the spec 070 cache, never inline.** This is what makes `promptFingerprint` reproducible across runs and what lets governance audit "what did the model actually see." Lint will reject inline prompt strings in `extractors/agent-*.ts`.
- **Cost ceilings live in the workspace policy slice; day-aggregate is tracked in `knowledge_extraction_runs`.** Pre-flight estimate (input tokens × pinned model rate) is checked against `costCeilingUsdPerCall` *and* against `costCeilingUsdPerDay - sum(today's runs)`. Pre-flight denial does not bill; mid-call surprise (output tokens overshoot estimate) is recorded and counted against tomorrow's budget — we do not abort an in-flight call.
- **Failure parks at `imported`, not at a new `failed` state.** Keeps the enum stable for downstream code (`resolveKnowledgeForFactory`, list filters). The signal for "failed" is `lastExtractionError IS NOT NULL`. The Retry endpoint clears it on success.
- **Retry never re-runs the failing extractor.** The dispatcher re-picks based on current policy + sniffed mime. A deterministic-PDF failure that retries will route to the agent vision extractor if policy allows, not loop on the broken parser.
- **Auto-retry capped at 2; operator-Retry is unlimited.** PubSub at-least-once gives us duplicate deliveries and worker restarts will redeliver; we cap to keep a poison message from looping. The Retry endpoint is the only manual lever and is unbounded — operators can keep pressing it.
- **Legacy `transitionState` retained but disabled by default.** Removing it would break any existing in-flight scripts and remove a debug lever. Gating it behind `STATECRAFT_EXTRACT_LEGACY_TRANSITION = false` means it has zero footprint in production but is one env flip away during an incident. Audit rows tag `legacy_path = true` so usage shows up.
- **`extraction_output` validated at write time, not in the SQL schema.** Postgres JSONB cannot enforce the typed shape (FR-016) cheaply. Drizzle wraps the insert with a Zod parse so a malformed payload fails the run with `extractor_returned_malformed_output` instead of silently corrupting the workspace's knowledge.
- **Pre-pass for embedded text uses per-page text counts, not a binary "any text" check.** A scan PDF that happens to have one page with a tiny title would otherwise route to the deterministic path and return near-empty text. Median per-page text length below a threshold (`EMBEDDED_TEXT_MIN_MEDIAN_CHARS`, default 80) routes to the agent path.
- **Worker checks for object deletion immediately before writing `extraction_output`.** A `SELECT … FOR UPDATE` on the row inside the writing transaction; if it's gone the run row transitions to `abandoned` and the worker exits without a `knowledge.extracted` audit row. This closes the race where a user deletes mid-run.

## Risks

- **Cost runaways via misconfigured policy.** A workspace with permissive defaults and a connector flood could rack up real money before the day ceiling trips. Mitigation: ship with `costCeilingUsdPerDay = 5.00` baked into the default policy; require an explicit policy override to raise it; emit a `knowledge.extraction_cost_threshold` audit row at 50% / 80% / 100% of the day ceiling so operators see drift before exhaustion.
- **PDF heuristic misroutes mixed documents.** A real-world report with embedded body text but scanned signature pages should not be split. Mitigation: the deterministic extractor extracts what it can per-page; if median text density meets the threshold the run completes with a `metadata.lowTextPages = [n…]` array surfaced in the dashboard so an operator can choose to re-extract via agent.
- **Anthropic rate limits during connector floods.** A SharePoint sync of 5,000 image-only PDFs blasts the API. Mitigation: Encore subscription concurrency cap (default 8) + per-day cost ceiling provide back-pressure. The cap is workspace-scoped via the policy slice; orgs that need more can raise it explicitly.
- **Mime sniff adds latency on small files.** A 400-byte JSON file pulling a 4KB ranged GET is silly. Mitigation: skip sniff when `sizeBytes < 4096` and trust the declared type; for files that small, the cost of a wrong dispatch is also small.
- **PubSub at-least-once produces duplicate deliveries.** Worker restarts and message redelivery are normal. Mitigation: CAS on `pending → running` already covered (spec 114 pattern); test explicitly covers double-delivery and asserts a single completion.
- **Anthropic SDK connection-pool exhaustion under high concurrency.** With 8 concurrent extractions plus the existing statecraft API surface using the same client, pool limits could bite. Mitigation: dedicated `AnthropicClient` instance per worker with its own pool; bounded by `STATECRAFT_EXTRACT_WORKER_CONCURRENCY`.
- **Policy bundle not yet compiled for a brand-new workspace.** First-upload edge case. Mitigation: a built-in *deterministic-only* fallback policy (vision off, audio off, ceilings $0); objects requiring an agent extractor park at `imported` with `policy_pending`. The policy compiler emitting a real bundle clears the gate; a sweeper retries `policy_pending` objects on bundle commit.
- **Schema validation cost on hot path.** Zod parse on every insert is non-trivial. Mitigation: cache the compiled schema; benchmark before merge — if it shows up in the run-completion p95, switch to a hand-written validator.
- **Removing the manual transition button breaks any operator-built tooling.** Some internal scripts may POST to `/transition` directly. Mitigation: the legacy endpoint stays in code, returns `precondition_failed` with a clear message, and an env flag (`STATECRAFT_EXTRACT_LEGACY_TRANSITION`) re-enables it. Migration note in the PR description points at the Retry endpoint as the modern equivalent.

## References

- Spec: [`./spec.md`](./spec.md)
- Pattern reuse (spec 114):
  - `platform/services/statecraft/api/projects/cloneEvents.ts` — Topic shape we copy
  - `platform/services/statecraft/api/projects/cloneWorker.ts` — Subscription + CAS + staleness pattern
  - `platform/services/statecraft/api/projects/cloneCore.ts` — heavy-work module separation we mirror
- Existing primitives this spec extends:
  - `platform/services/statecraft/api/knowledge/knowledge.ts:293-367` — `confirmUpload`; insertion point for enqueue
  - `platform/services/statecraft/api/knowledge/knowledge.ts:436-501` — legacy `transitionState`; gated by env post-spec
  - `platform/services/statecraft/api/knowledge/scheduler.ts` — connector sync orchestrator + new staleness cron
  - `platform/services/statecraft/api/knowledge/connectors/*` — `sync()` paths get enqueue hooks on new-row insert
  - `platform/services/statecraft/api/knowledge/storage.ts` — `headObject` + ranged GET helper for mime sniff
  - `platform/services/statecraft/api/sync/sync.ts` — `broadcastToWorkspace` for live status updates
  - `platform/services/statecraft/api/db/schema.ts` — Drizzle schema additions (run table + `lastExtractionError`)
  - `platform/services/statecraft/web/app/routes/app.project.$projectId.knowledge.$id.tsx:172-184` — manual transition button to remove
  - `platform/services/statecraft/web/app/routes/app.project.$projectId.knowledge.tsx` — list view to gain `latestRun` denormalisation
- Cross-crate dependencies:
  - `crates/policy-kernel` — new `resolveExtractionPolicy(workspaceId)` helper exposed via statecraft FFI / HTTP shim
  - `product/packages/prompt-assembly` (spec 070) — versioned prompt source for agent extractors; provides `promptFingerprint`
  - `crates/tool-registry` (spec 067) + `crates/agent` safety tier registration (spec 036) — agent extractors register at the appropriate tier so a tool-bearing call fails closed
- Related specs: 036 (safety tiers), 047 (governance control plane), 070 (prompt-assembly cache), 087 (knowledge intake domain), 114 (async clone pipeline pattern)
