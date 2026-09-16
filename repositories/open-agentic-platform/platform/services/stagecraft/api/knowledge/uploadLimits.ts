// Spec 143 FR-011 — single source of truth for the knowledge-upload
// size cap.
//
// The cap is enforced at three layers (FR-011): browser pre-check
// before requestUpload fires, server-side check inside the
// requestUpload Encore handler, and nginx ingress body-size annotation
// on the MinIO public ingress (FR-005). All three layers MUST agree
// on the same number; if they drift, the failure mode is the
// cryptic "413 Request Entity Too Large" from nginx that FR-011
// specifically describes as "should never fire" — observing it in
// production means the server-side check has regressed below the
// ingress cap.
//
// The browser and server import this module directly (web/app/...
// resolves into api/knowledge/... via relative imports, the existing
// pattern used by `web/app/lib/agents-api.server.ts` for shared
// Encore types). The Helm chart's ingress annotation lives in
// `platform/charts/statecraft/values-hetzner.yaml`; that value MUST
// be kept in sync with KNOWLEDGE_UPLOAD_MAX_BYTES below by the
// implementation step that lands the ingress wiring (spec 143 §7
// step 6). When the size cap changes, the change MUST traverse
// this constant first, then propagate to the chart value.

/**
 * Maximum byte size for a single browser upload (FR-011).
 * 1 GiB = 1024^3 bytes = 1_073_741_824.
 *
 * Rationale: matches the upper bound for single-PUT presigning that
 * spec 143 commits to; multipart upload (which would lift this cap)
 * is explicitly out of scope per FR-013.
 */
export const KNOWLEDGE_UPLOAD_MAX_BYTES = 1024 * 1024 * 1024;

/**
 * Human-readable form for use in error messages and toasts.
 * Kept here so the limit string never drifts from the byte value
 * across browser, server, and any docs that reference it.
 */
export const KNOWLEDGE_UPLOAD_MAX_HUMAN = "1 GiB";
