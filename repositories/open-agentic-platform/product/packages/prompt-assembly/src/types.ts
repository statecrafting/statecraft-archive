// SPDX-License-Identifier: AGPL-3.0-or-later
// Feature: 070-prompt-assembly-cache

/**
 * Cache lifetime determines when a section's content is regenerated.
 *
 * - Static: assembled once, reused across all turns (tool schemas, rules)
 * - PerSession: assembled once per session, cached within session
 * - Dynamic: rebuilt every turn (workflow state, memory, environment)
 */
export type CacheLifetime = "static" | "per_session" | "dynamic";

/**
 * Context passed to section content functions during assembly.
 * Sections use this to access session state, configuration, etc.
 */
export interface AssemblyContext {
  /** Current session identifier */
  readonly sessionId: string;
  /** Model context window size in tokens (used for compaction threshold) */
  readonly modelContextWindow: number;
  /** Arbitrary key-value data sections can read */
  readonly vars: Record<string, unknown>;
}

/**
 * A registered prompt section that contributes content to the assembled prompt.
 */
export interface PromptSection {
  /** Unique section name */
  readonly name: string;
  /** Returns the section's content string */
  readonly contentFn: (ctx: AssemblyContext) => string;
  /** Determines caching behavior */
  readonly cacheLifetime: CacheLifetime;
  /** Higher priority = earlier in prompt. Static sections should use >= 500. */
  readonly priority: number;
  /** Maximum bytes for this section's content (truncated if exceeded) */
  readonly maxBytes: number;
}

/**
 * Metadata about a single section in the assembled prompt.
 */
export interface SectionMetadata {
  readonly name: string;
  readonly cacheLifetime: CacheLifetime;
  readonly priority: number;
  readonly originalBytes: number;
  readonly finalBytes: number;
  readonly truncated: boolean;
  readonly cacheHit: boolean;
}

/**
 * The fully assembled prompt with static/dynamic split.
 */
export interface AssembledPrompt {
  /** Cacheable prefix — stable across turns */
  readonly staticPrefix: string;
  /** Machine-readable boundary marker */
  readonly cacheBoundary: string;
  /** Per-turn suffix — rebuilt each turn */
  readonly dynamicSuffix: string;
  /** Assembly metadata for observability */
  readonly metadata: AssemblyMetadata;
}

/**
 * Observability metadata emitted after each assembly.
 */
export interface AssemblyMetadata {
  readonly totalBytes: number;
  readonly sectionCount: number;
  readonly sections: readonly SectionMetadata[];
  readonly truncatedSections: readonly string[];
  readonly budgetExceeded: boolean;
}

/**
 * A message in the conversation history (for compaction).
 */
export interface Message {
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
}

/**
 * Result of a compaction operation.
 */
export interface CompactionResult {
  /** Summary of compacted messages */
  readonly summary: string;
  /** Messages kept uncompacted (most recent) */
  readonly keptMessages: readonly Message[];
  /** Number of messages that were summarized */
  readonly compactedCount: number;
  /** Estimated byte reduction */
  readonly bytesSaved: number;
}

/**
 * Options for creating a PromptAssembler.
 */
export interface AssemblerOptions {
  /** Total budget in bytes for the assembled prompt (default: 102400 = 100KB) */
  readonly totalBudget?: number;
}

/**
 * Options for creating a CompactionService.
 */
export interface CompactionOptions {
  /** Fraction of context window that triggers compaction (default: 0.8) */
  readonly windowThreshold?: number;
  /** Number of recent messages to keep uncompacted (default: 10) */
  readonly keepRecent?: number;
  /** Function that summarizes messages into a compact string */
  readonly summarizer?: (messages: readonly Message[]) => string;
}
