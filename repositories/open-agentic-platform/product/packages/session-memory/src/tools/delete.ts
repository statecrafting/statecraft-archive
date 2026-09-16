/**
 * memory_delete tool handler (FR-001).
 */

import type { MemoryStorage } from "../storage/sqlite.js";

export interface DeleteToolInput {
  id: string;
}

export function handleMemoryDelete(storage: MemoryStorage, input: DeleteToolInput): { deleted: boolean } {
  if (!input.id || typeof input.id !== "string") {
    throw new Error("id is required and must be a string");
  }

  return { deleted: storage.delete(input.id) };
}
