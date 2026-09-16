/**
 * Session-memory write gate (spec 204 FR-001).
 *
 * Every memory write passes this rule-only gate before it can be persisted.
 * The carrier-class / secret / UTF-8 rules are the shared canonical set from
 * `@opc/carrier-gate` (the same rules the factory substrate gate enforces,
 * spec 198 `overrideGate.ts`): "shared with, not copied from". The size
 * ceiling is memory-specific. Fail-closed: the first violated rule refuses the
 * write with an attributable rule id. A model may detect, only these rules may
 * block.
 */

import { runCarrierGate, type CarrierVerdict } from "@opc/carrier-gate";

/** Byte ceiling for a single memory entry's content (memory-specific). */
export const MEMORY_MAX_BYTES = 64 * 1024;

/**
 * Run the deterministic write gate over memory content. Returns `{ ok: true }`
 * or the first refused rule. The memory-specific size ceiling is checked first
 * (a cheap byte-length compare) so an oversized write fails fast before the
 * carrier regexes scan it; then the shared carrier/secret/utf8 gate runs.
 */
export function runMemoryWriteGate(content: string): CarrierVerdict {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MEMORY_MAX_BYTES) {
    return {
      ok: false,
      ruleId: "gate.size-ceiling",
      detail: `content is ${bytes} bytes; the memory write ceiling is ${MEMORY_MAX_BYTES}`,
    };
  }
  return runCarrierGate(content);
}

/**
 * Gate a full store input: the content through the write gate, and each tag
 * through the shared carrier gate. Tags are persisted and re-injected into
 * later sessions' prompts (see `integration.ts` `formatMemoriesForPrompt`), so
 * they carry the same carrier-poisoning risk as content and are refused by the
 * same rules (tags are not size-capped; they are short labels). Returns the
 * first refusal, or `{ ok: true }`.
 */
export function runMemoryStoreGate(
  content: string,
  tags: readonly string[] = [],
): CarrierVerdict {
  const contentVerdict = runMemoryWriteGate(content);
  if (!contentVerdict.ok) return contentVerdict;

  for (const tag of tags) {
    const tagVerdict = runCarrierGate(tag);
    if (!tagVerdict.ok) {
      return {
        ok: false,
        ruleId: tagVerdict.ruleId,
        detail: `tag ${JSON.stringify(tag)}: ${tagVerdict.detail}`,
      };
    }
  }
  return { ok: true };
}

/** Error thrown by the storage layer when the write gate refuses content. */
export class MemoryWriteRefused extends Error {
  readonly ruleId: string;
  readonly detail: string;
  constructor(ruleId: string, detail: string) {
    super(`memory write refused (${ruleId}): ${detail}`);
    this.name = "MemoryWriteRefused";
    this.ruleId = ruleId;
    this.detail = detail;
  }
}
