/**
 * Harvesting engine — post-turn signal detection (FR-003).
 *
 * Scans conversation text against harvesting rules and produces
 * memory entries for detected signals.
 */

import type { MemoryKind, ImportanceLevel, StoreMemoryInput } from "../types.js";
import type { HarvestRule } from "./rules.js";
import { BUILTIN_RULES } from "./rules.js";

/** A signal detected by the harvesting engine. */
export interface HarvestedSignal {
  ruleId: string;
  kind: MemoryKind;
  importance: ImportanceLevel;
  content: string;
  matchText: string;
}

/** Result of running the harvester on a text. */
export interface HarvestResult {
  signals: HarvestedSignal[];
  durationMs: number;
}

export interface HarvestOptions {
  rules?: HarvestRule[];
  projectScope?: string;
  sourceSessionId?: string;
  /** Deduplicate signals with identical content. Default: true. */
  deduplicate?: boolean;
}

/**
 * Run the harvesting engine against a text (typically an assistant turn).
 *
 * Returns all detected signals without storing them — the caller
 * (or MCP server integration) decides whether to persist.
 */
export function harvest(text: string, options?: HarvestOptions): HarvestResult {
  const start = performance.now();
  const rules = options?.rules ?? BUILTIN_RULES;
  const deduplicate = options?.deduplicate ?? true;
  const signals: HarvestedSignal[] = [];
  const seen = new Set<string>();

  for (const rule of rules) {
    // Reset regex lastIndex for global patterns
    rule.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = rule.pattern.exec(text)) !== null) {
      const content = rule.extractContent(match, text);
      if (!content) continue;

      // Dedup by content
      if (deduplicate && seen.has(content)) continue;
      seen.add(content);

      signals.push({
        ruleId: rule.id,
        kind: rule.kind,
        importance: rule.importance,
        content,
        matchText: match[0],
      });
    }
  }

  return {
    signals,
    durationMs: performance.now() - start,
  };
}

/** Convert harvested signals to StoreMemoryInput entries ready for persistence. */
export function signalsToStoreInputs(
  signals: HarvestedSignal[],
  projectScope: string,
  sourceSessionId: string,
): StoreMemoryInput[] {
  return signals.map((signal) => ({
    content: signal.content,
    kind: signal.kind,
    importance: signal.importance,
    tags: [signal.ruleId],
    projectScope,
    sourceSessionId,
    // Spec 204 FR-002: harvested entries are authored by the harvester, not an
    // agent turn, and attribute the harvest rule that produced them. The trust
    // class derives to machine-harvested (only a human actor is human-curated).
    actorKind: "harvester" as const,
    sourceAttribution: `harvest-rule:${signal.ruleId}`,
  }));
}
