// Spec 204 FR-001: the canonical carrier-class rule set.
//
// Authored as plain ESM JavaScript (not TypeScript) on purpose. This leaf is
// imported across the Encore service boundary by statecraft's overrideGate.ts.
// Encore installs and requires node_modules dependencies at runtime, so the
// shared module must be directly Node-loadable: a raw `.ts` entry point cannot
// be imported by the production runtime. Shipping `.js` keeps ONE canonical
// rule set that loads unchanged in the Encore runtime, the pnpm workspace
// (vitest/tsc), and plain Node, with no build step and no committed `dist`.
// Public types are declared in `index.d.ts`.
//
// Rules are pure functions over the candidate content; there is no I/O, no
// model call, and no clock, so the same input always produces the same
// verdict. A model may detect, only these rules may block.
//
// Consumer-specific policy (the substrate's 256 KiB size ceiling, its
// structured-kind parse check) is NOT here: those are not carrier classes and
// have no analog on the free-text memory surface. Each consumer composes its
// own ceiling around this shared carrier core (see plan.md Decision 1).

/** @typedef {{ ruleId: string, detail: string }} CarrierRefusal */
/** @typedef {{ ok: true } | ({ ok: false } & CarrierRefusal)} CarrierVerdict */

/** Base64-ish runs longer than this are refused as encoded blobs (ASI01 m6). */
export const ENCODED_BLOB_RUN_CHARS = 2048;

// A high surrogate not followed by a low surrogate, or a low surrogate not
// preceded by a high one: the malformed-UTF-16 shapes that cannot encode to
// UTF-8.
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

// U+200B..U+200F zero-width + directional marks, U+202A..U+202E embedding
// overrides, U+2060..U+2064 invisible operators, U+2066..U+2069 isolates,
// U+FEFF BOM/ZWNBSP. The Trojan-Source / hidden-instruction carrier class.
const ZERO_WIDTH_BIDI = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/;

// data: URIs smuggle payloads past content review in markdown/HTML sinks.
const DATA_URI = /\bdata:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,/i;

// ANSI escape sequences (terminal injection when bodies are echoed to TTYs).
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /\u001B/;

// CONST-002 secret shapes: PEM blocks, VCS/cloud token prefixes, JWT triplets.
const PEM_BLOCK = /-----BEGIN [A-Z0-9 ]+-----/;
const TOKEN_SHAPES = [
  { name: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: "github-app-token", re: /\bghs_[A-Za-z0-9]{20,}\b/ },
  { name: "gitlab-pat", re: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
  { name: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
];
const JWT_LIKE =
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/;

// Long base64-ish runs. Whitespace breaks a run; `=` only counts at the tail,
// so prose with long unbroken words does not false-positive (the alphabet
// still requires [A-Za-z0-9+/]).
const ENCODED_BLOB_RE = new RegExp(
  `[A-Za-z0-9+/]{${ENCODED_BLOB_RUN_CHARS},}={0,2}`,
);

/**
 * @param {string} ruleId
 * @param {string} detail
 * @returns {CarrierRefusal}
 */
function refusal(ruleId, detail) {
  return { ruleId, detail };
}

/**
 * gate.utf8: lone surrogates cannot round-trip through storage as UTF-8.
 * Returns the refusal, or null if the content is well-formed. Kept separate
 * from the carrier/secret checks so a consumer can preserve its own rule
 * ordering (overrideGate runs utf8 before its size/kind checks).
 * @param {string} content
 * @returns {CarrierRefusal | null}
 */
export function checkUtf8(content) {
  if (LONE_SURROGATE.test(content)) {
    return refusal("gate.utf8", "content contains unpaired surrogates");
  }
  return null;
}

/**
 * The carrier-class refusals (ASI01 m6), in declaration order: zero-width /
 * bidi, HTML comment, data: URI, encoded blob, ANSI escape. Returns the first
 * refusal, or null.
 * @param {string} content
 * @returns {CarrierRefusal | null}
 */
export function checkCarriers(content) {
  if (ZERO_WIDTH_BIDI.test(content)) {
    return refusal(
      "gate.carrier.zero-width-bidi",
      "content contains zero-width or bidirectional control characters",
    );
  }
  if (content.includes("<!--")) {
    return refusal(
      "gate.carrier.html-comment",
      "content contains an HTML comment (hidden-payload carrier)",
    );
  }
  if (DATA_URI.test(content)) {
    return refusal(
      "gate.carrier.data-uri",
      "content contains a base64 data: URI",
    );
  }
  if (ENCODED_BLOB_RE.test(content)) {
    return refusal(
      "gate.carrier.encoded-blob",
      `content contains a base64-like run longer than ${ENCODED_BLOB_RUN_CHARS} characters`,
    );
  }
  if (ANSI_ESCAPE.test(content)) {
    return refusal(
      "gate.carrier.ansi-escape",
      "content contains ANSI escape sequences",
    );
  }
  return null;
}

/**
 * The CONST-002 secret-shape refusals, in declaration order: PEM block,
 * credential token prefix, JWT triplet. Returns the first refusal, or null.
 * @param {string} content
 * @returns {CarrierRefusal | null}
 */
export function checkSecrets(content) {
  if (PEM_BLOCK.test(content)) {
    return refusal("gate.secret.pem", "content contains a PEM block");
  }
  for (const t of TOKEN_SHAPES) {
    if (t.re.test(content)) {
      return refusal(
        "gate.secret.token",
        `content matches the ${t.name} credential shape`,
      );
    }
  }
  if (JWT_LIKE.test(content)) {
    return refusal("gate.secret.jwt", "content contains a JWT-shaped string");
  }
  return null;
}

/**
 * Run the full carrier gate: UTF-8, then carriers, then secrets, in that
 * order. The first refused rule wins. Use this on surfaces that have no
 * interleaved consumer-specific checks (session memory); overrideGate calls
 * the granular checks so its size/kind rules keep their original position.
 * @param {string} content
 * @returns {CarrierVerdict}
 */
export function runCarrierGate(content) {
  const refused =
    checkUtf8(content) ?? checkCarriers(content) ?? checkSecrets(content);
  return refused ? { ok: false, ...refused } : { ok: true };
}
