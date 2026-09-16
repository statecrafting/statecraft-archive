/**
 * memory_store tool handler (FR-001).
 */

import type { MemoryStorage } from "../storage/sqlite.js";
import type { StoreMemoryInput, MemoryEntry } from "../types.js";

export interface StoreToolInput {
  content: string;
  kind: string;
  importance?: string;
  tags?: string[];
  projectScope?: string;
}

export function handleMemoryStore(storage: MemoryStorage, input: StoreToolInput, defaults: { projectScope: string; sourceSessionId: string }): MemoryEntry {
  if (!input.content || typeof input.content !== "string") {
    throw new Error("content is required and must be a string");
  }

  const validKinds = ["decision", "correction", "pattern", "note", "preference"];
  if (!validKinds.includes(input.kind)) {
    throw new Error(`kind must be one of: ${validKinds.join(", ")}`);
  }

  const validImportance = ["ephemeral", "short-term", "medium-term", "long-term", "permanent"];
  if (input.importance && !validImportance.includes(input.importance)) {
    throw new Error(`importance must be one of: ${validImportance.join(", ")}`);
  }

  // This is the UNTRUSTED MCP surface (called by agents). It does not accept
  // provenance or trust inputs (FR-005): every write here is authored by the
  // agent (storage.store defaults actorKind to `agent`, deriving
  // machine-harvested trust), and the origin session is the server's trusted
  // session id, never a caller-claimed one. Human-curated / harvester writes
  // come only from trusted non-MCP callers of storage.store.
  const storeInput: StoreMemoryInput = {
    content: input.content,
    kind: input.kind as StoreMemoryInput["kind"],
    importance: (input.importance as StoreMemoryInput["importance"]) ?? undefined,
    tags: input.tags,
    projectScope: input.projectScope ?? defaults.projectScope,
    sourceSessionId: defaults.sourceSessionId,
  };

  return storage.store(storeInput);
}
