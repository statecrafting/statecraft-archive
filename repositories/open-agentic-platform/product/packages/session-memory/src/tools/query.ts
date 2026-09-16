/**
 * memory_query tool handler (FR-001, FR-005).
 */

import type { MemoryStorage } from "../storage/sqlite.js";
import type { MemoryEntry, QueryMemoryInput } from "../types.js";

export interface QueryToolInput {
  text?: string;
  tags?: string[];
  kind?: string;
  importance?: string;
  projectScope?: string;
  limit?: number;
}

export function handleMemoryQuery(storage: MemoryStorage, input: QueryToolInput, defaults: { projectScope: string }): MemoryEntry[] {
  const projectScope = input.projectScope ?? defaults.projectScope;
  if (!projectScope) {
    throw new Error("projectScope is required");
  }

  const queryInput: QueryMemoryInput = {
    projectScope,
    text: input.text,
    tags: input.tags,
    kind: input.kind as QueryMemoryInput["kind"],
    importance: input.importance as QueryMemoryInput["importance"],
    limit: input.limit,
  };

  return storage.query(queryInput);
}
