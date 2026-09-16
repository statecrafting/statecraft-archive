/**
 * Session integration — automatic memory loading on session start (FR-006, SC-006).
 *
 * Retrieves relevant memories for a project and formats them for
 * injection into an agent's initial context.
 */

import type { MemoryEntry, MemoryKind, ImportanceLevel } from "./types.js";
import { IMPORTANCE_ORDER } from "./types.js";
import { MemoryStorage } from "./storage/sqlite.js";

export interface SessionLoadOptions {
  projectScope: string;
  /** Max memories to inject into context. Default: 20 (R-003 mitigation). */
  maxEntries?: number;
  /** Minimum importance level to include. Default: "short-term" (excludes ephemeral). */
  minImportance?: ImportanceLevel;
  /** Only include specific kinds. Default: all kinds. */
  kinds?: MemoryKind[];
  /** Custom database path (for testing). */
  databasePath?: string;
}

export interface SessionLoadResult {
  entries: MemoryEntry[];
  promptText: string;
  entryCount: number;
}

/** Importance rank for sorting (higher = more important). */
function importanceRank(importance: ImportanceLevel): number {
  return IMPORTANCE_ORDER.indexOf(importance);
}

/**
 * Load relevant memories for a session and format as prompt context (FR-006).
 *
 * Retrieves memories scoped to the project, filters by importance,
 * sorts by importance (desc) then recency (desc), and formats as
 * markdown for injection into an agent's system prompt.
 */
export function loadSessionMemories(options: SessionLoadOptions): SessionLoadResult {
  const maxEntries = options.maxEntries ?? 20;
  const minImportance = options.minImportance ?? "short-term";
  const minRank = importanceRank(minImportance);

  const storage = options.databasePath
    ? new MemoryStorage(options.databasePath)
    : MemoryStorage.forProject(options.projectScope);

  try {
    // Fetch a generous batch, then filter and sort client-side
    const entries = storage.list({
      projectScope: options.projectScope,
      limit: maxEntries * 3, // over-fetch to account for filtering
    });

    const filtered = entries
      .filter((e) => importanceRank(e.importance) >= minRank)
      .filter((e) => !options.kinds || options.kinds.includes(e.kind));

    // Sort: highest importance first, then most recently updated
    filtered.sort((a, b) => {
      const impDiff = importanceRank(b.importance) - importanceRank(a.importance);
      if (impDiff !== 0) return impDiff;
      return b.updatedAt - a.updatedAt;
    });

    const selected = filtered.slice(0, maxEntries);

    const promptText = formatMemoriesForPrompt(selected);

    return {
      entries: selected,
      promptText,
      entryCount: selected.length,
    };
  } finally {
    storage.close();
  }
}

/** Format memory entries as markdown for prompt injection. */
export function formatMemoriesForPrompt(entries: MemoryEntry[]): string {
  if (entries.length === 0) return "";

  const lines: string[] = [
    "## Project Memory",
    "",
    `The following ${entries.length} ${entries.length === 1 ? "memory" : "memories"} from previous sessions may be relevant:`,
    "",
  ];

  // Group by kind for readability
  const grouped = new Map<MemoryKind, MemoryEntry[]>();
  for (const entry of entries) {
    const list = grouped.get(entry.kind) ?? [];
    list.push(entry);
    grouped.set(entry.kind, list);
  }

  const kindOrder: MemoryKind[] = ["decision", "correction", "preference", "pattern", "note"];

  for (const kind of kindOrder) {
    const kindEntries = grouped.get(kind);
    if (!kindEntries || kindEntries.length === 0) continue;

    const kindLabel = kind.charAt(0).toUpperCase() + kind.slice(1) + "s";
    lines.push(`### ${kindLabel}`);
    lines.push("");

    for (const entry of kindEntries) {
      const tags = entry.tags.length > 0 ? ` [${entry.tags.join(", ")}]` : "";
      lines.push(`- ${entry.content}${tags}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

/**
 * Compose an agent's system prompt with session memories appended (SC-006).
 *
 * Returns the base prompt unchanged if no memories match.
 */
export function composeSessionPrompt(basePrompt: string, options: SessionLoadOptions): string {
  const result = loadSessionMemories(options);
  if (result.entryCount === 0) return basePrompt;
  return `${basePrompt}\n\n${result.promptText}`;
}
