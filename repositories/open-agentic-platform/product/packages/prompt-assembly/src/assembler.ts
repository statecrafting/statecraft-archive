// SPDX-License-Identifier: AGPL-3.0-or-later
// Feature: 070-prompt-assembly-cache

import type {
  AssembledPrompt,
  AssemblerOptions,
  AssemblyContext,
  AssemblyMetadata,
  PromptSection,
  SectionMetadata,
} from "./types.js";

/**
 * Machine-readable boundary marker between static and dynamic prompt regions.
 * The API client uses this to place the cache breakpoint.
 */
export const CACHE_BOUNDARY_MARKER =
  "\n═══ CACHE BOUNDARY ═══\n";

const DEFAULT_TOTAL_BUDGET = 102_400; // 100 KB

/**
 * Truncate content to fit within a byte budget.
 * If truncated, appends a notice so the model knows content was cut.
 */
export function truncateToBytes(content: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(content);
  if (bytes.length <= maxBytes) return content;

  const notice = "\n[... truncated to fit budget ...]";
  const noticeBytes = encoder.encode(notice).length;
  const available = Math.max(0, maxBytes - noticeBytes);

  // Truncate at byte level, then decode back (handles multi-byte safely)
  const truncated = new TextDecoder().decode(bytes.slice(0, available));
  return truncated + notice;
}

/**
 * PromptAssembler composes registered sections into a two-region system prompt
 * with a cache boundary between static and dynamic content.
 *
 * Static and per_session sections are cached after first assembly.
 * Dynamic sections are rebuilt every turn.
 *
 * Sections are ordered by priority (descending). When the total budget is
 * exceeded, remaining sections are dropped with a truncation notice.
 *
 * FR-001: Two regions separated by cache boundary
 * FR-002: Sections registered with name, contentFn, cacheLifetime, priority, maxBytes
 * FR-005: Budget enforcement with truncation from lowest-priority
 * FR-007: Runtime registration via registerSection()
 * FR-008: Structured metadata emission
 * NF-001: Assembly completes in <10ms for 30 sections (excluding content generation)
 * NF-002: Static content is deterministic for cache effectiveness
 */
export class PromptAssembler {
  private sections: PromptSection[] = [];
  private readonly cache = new Map<string, string>();
  private readonly totalBudget: number;

  constructor(options: AssemblerOptions = {}) {
    this.totalBudget = options.totalBudget ?? DEFAULT_TOTAL_BUDGET;
  }

  /**
   * Register a new prompt section. (FR-007)
   * Sections are re-sorted by priority descending on each registration.
   */
  registerSection(section: PromptSection): void {
    this.sections.push(section);
    this.sections.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Remove a section by name.
   */
  removeSection(name: string): boolean {
    const before = this.sections.length;
    this.sections = this.sections.filter((s) => s.name !== name);
    this.cache.delete(name);
    return this.sections.length < before;
  }

  /**
   * Invalidate the cache for a specific section (e.g., when CLAUDE.md changes).
   * Pass no arguments to invalidate the entire cache.
   */
  invalidateCache(name?: string): void {
    if (name) {
      this.cache.delete(name);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Return a snapshot of registered section names in priority order.
   */
  get sectionNames(): readonly string[] {
    return this.sections.map((s) => s.name);
  }

  /**
   * Assemble the full system prompt. (FR-001, FR-005, FR-008)
   *
   * 1. Iterate sections in priority order (descending).
   * 2. Resolve content — from cache for static/per_session, fresh for dynamic.
   * 3. Truncate per-section if over maxBytes.
   * 4. Stop adding sections when total budget exceeded.
   * 5. Separate static and dynamic parts with the cache boundary marker.
   */
  assemble(ctx: AssemblyContext): AssembledPrompt {
    const staticParts: string[] = [];
    const dynamicParts: string[] = [];
    const sectionMetas: SectionMetadata[] = [];
    const truncatedSections: string[] = [];
    let totalSize = 0;
    let budgetExceeded = false;

    for (const section of this.sections) {
      // Resolve content, using cache for static/per_session
      let cacheHit = false;
      let content: string;

      if (
        section.cacheLifetime === "static" ||
        section.cacheLifetime === "per_session"
      ) {
        const cached = this.cache.get(section.name);
        if (cached !== undefined) {
          content = cached;
          cacheHit = true;
        } else {
          content = section.contentFn(ctx);
          this.cache.set(section.name, content);
        }
      } else {
        content = section.contentFn(ctx);
      }

      const originalBytes = new TextEncoder().encode(content).length;

      // Per-section truncation
      const truncated = truncateToBytes(content, section.maxBytes);
      const finalBytes = new TextEncoder().encode(truncated).length;
      const wasTruncated = finalBytes < originalBytes;

      // Check total budget
      if (totalSize + finalBytes > this.totalBudget) {
        budgetExceeded = true;
        truncatedSections.push(section.name);
        // Record metadata for dropped section
        sectionMetas.push({
          name: section.name,
          cacheLifetime: section.cacheLifetime,
          priority: section.priority,
          originalBytes,
          finalBytes: 0,
          truncated: true,
          cacheHit,
        });
        continue;
      }

      totalSize += finalBytes;

      if (wasTruncated) {
        truncatedSections.push(section.name);
      }

      sectionMetas.push({
        name: section.name,
        cacheLifetime: section.cacheLifetime,
        priority: section.priority,
        originalBytes,
        finalBytes,
        truncated: wasTruncated,
        cacheHit,
      });

      // Route to static or dynamic bucket
      if (
        section.cacheLifetime === "static" ||
        section.cacheLifetime === "per_session"
      ) {
        staticParts.push(truncated);
      } else {
        dynamicParts.push(truncated);
      }
    }

    const metadata: AssemblyMetadata = {
      totalBytes: totalSize,
      sectionCount: staticParts.length + dynamicParts.length,
      sections: sectionMetas,
      truncatedSections,
      budgetExceeded,
    };

    return {
      staticPrefix: staticParts.join("\n"),
      cacheBoundary: CACHE_BOUNDARY_MARKER,
      dynamicSuffix: dynamicParts.join("\n"),
      metadata,
    };
  }

  /**
   * Convenience: assemble and return the full prompt as a single string.
   */
  assembleString(ctx: AssemblyContext): string {
    const result = this.assemble(ctx);
    return (
      result.staticPrefix + result.cacheBoundary + result.dynamicSuffix
    );
  }
}
