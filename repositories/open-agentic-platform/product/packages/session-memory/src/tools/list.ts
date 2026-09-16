/**
 * memory_list tool handler (FR-001).
 */

import type { MemoryStorage } from "../storage/sqlite.js";
import type { MemoryEntry, ListMemoryInput } from "../types.js";

export interface ListToolInput {
  projectScope?: string;
  kind?: string;
  limit?: number;
  offset?: number;
}

export function handleMemoryList(storage: MemoryStorage, input: ListToolInput, defaults: { projectScope: string }): MemoryEntry[] {
  const projectScope = input.projectScope ?? defaults.projectScope;
  if (!projectScope) {
    throw new Error("projectScope is required");
  }

  const listInput: ListMemoryInput = {
    projectScope,
    kind: input.kind as ListMemoryInput["kind"],
    limit: input.limit,
    offset: input.offset,
  };

  return storage.list(listInput);
}
