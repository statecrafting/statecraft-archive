// Spec 198 FR-013(a): the deterministic, synchronous, fail-closed gate on
// every substrate `user_body` write (PD-6).
//
// The carrier-class + secret + UTF-8 rules are the canonical set owned by
// `@opc/carrier-gate` (spec 204 FR-001): overrideGate imports those
// predicates rather than carrying its own copies, so the substrate gate and
// the session-memory write gate share one rule set. The two rules that are
// specific to the substrate (the 256 KiB size ceiling and the structured-kind
// parse check) stay here and are interleaved in their original order.
//
// Rules are pure functions over the candidate content (+ the row's kind);
// the first violated rule wins and the write is refused with an attributable
// rule id. A model may detect (FR-013 d, spec 200): only these rules may
// block. No I/O, no model calls, no clock: the same input always produces the
// same verdict.
//
// Wired into: `artifacts.ts::applyOverrideCore`, `conflicts.ts`
// (`edit_and_accept` the side-door override revision), and the user-authored
// agent writes in `api/agents/catalog.ts` (FR-013 governs the write path
// class, not one endpoint).

import { parse as parseYaml } from "yaml";
import { checkCarriers, checkSecrets, checkUtf8 } from "@opc/carrier-gate";

// ---------------------------------------------------------------------------
// Verdict shape
// ---------------------------------------------------------------------------

export type OverrideGateVerdict =
  | { ok: true }
  | { ok: false; ruleId: string; detail: string };

export type OverrideGateInput = {
  content: string;
  /** Substrate row kind: drives the kind-stability parse check. */
  kind: string;
  /** Row path: picks JSON vs YAML for structured kinds. */
  path: string;
};

/** Size ceiling for a `user_body` revision (PD-6 default). */
export const OVERRIDE_MAX_BYTES = 256 * 1024;

// ---------------------------------------------------------------------------
// Rules: evaluated in declaration order; first hit refuses.
// ---------------------------------------------------------------------------

// Kinds whose content is structured; an override that no longer parses would
// silently change the row's classification downstream (PD-6 "kind stability").
// JSON for .json paths, YAML otherwise.
const STRUCTURED_KINDS = new Set([
  "contract-schema",
  "governance-envelope",
  "adapter-manifest",
  "reference-data",
]);

/**
 * Run the FR-013(a) gate. Deterministic; throws nothing. Callers turn a
 * refusal into their surface's attributable error + audit record.
 *
 * Order is preserved from the original single-file gate: utf8, then the two
 * substrate-specific rules (size ceiling, kind stability), then the shared
 * carrier and secret classes.
 */
export function runOverrideGate(input: OverrideGateInput): OverrideGateVerdict {
  const { content, kind, path } = input;

  // gate.utf8 (shared): lone surrogates cannot round-trip through storage as
  // UTF-8.
  const utf8 = checkUtf8(content);
  if (utf8) return { ok: false, ...utf8 };

  // gate.size-ceiling (substrate-specific)
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > OVERRIDE_MAX_BYTES) {
    return refuse(
      "gate.size-ceiling",
      `content is ${bytes} bytes; the override ceiling is ${OVERRIDE_MAX_BYTES}`,
    );
  }

  // gate.kind-stability (substrate-specific): structured kinds must still
  // parse as their shape.
  if (STRUCTURED_KINDS.has(kind)) {
    const parseError = structuredParseError(content, path);
    if (parseError) {
      return refuse(
        "gate.kind-stability",
        `override would break the row's '${kind}' classification: ${parseError}`,
      );
    }
  }

  // Carrier refusals (ASI01 m6) and secret shapes (CONST-002), shared with the
  // session-memory write gate via @opc/carrier-gate.
  const carriers = checkCarriers(content);
  if (carriers) return { ok: false, ...carriers };

  const secrets = checkSecrets(content);
  if (secrets) return { ok: false, ...secrets };

  return { ok: true };
}

function refuse(ruleId: string, detail: string): OverrideGateVerdict {
  return { ok: false, ruleId, detail };
}

function structuredParseError(content: string, path: string): string | null {
  if (path.toLowerCase().endsWith(".json")) {
    try {
      JSON.parse(content);
      return null;
    } catch (e) {
      return `not valid JSON (${(e as Error).message})`;
    }
  }
  try {
    parseYaml(content);
    return null;
  } catch (e) {
    return `not valid YAML (${(e as Error).message})`;
  }
}
