import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { PermissionDecision, PermissionEntry, PermissionScope } from "./types";

export const PERMISSION_STORE_VERSION = 1;

interface PermissionStoreDocument {
  version: number;
  entries: PermissionEntry[];
}

interface PermissionStorePaths {
  projectRoot: string;
  homeDir: string;
}

export interface PermissionStore {
  list(scope?: PermissionScope): Promise<PermissionEntry[]>;
  upsert(
    input: Omit<PermissionEntry, "id" | "createdAt"> & {
      id?: string;
      createdAt?: string;
    },
  ): Promise<PermissionEntry>;
  revoke(pattern: string, scope?: PermissionScope): Promise<number>;
  clearExpired(nowIso?: string, scope?: PermissionScope): Promise<number>;
}

const PROJECT_RELATIVE_PATH = path.join(".claude", "permissions.json");
const GLOBAL_RELATIVE_PATH = path.join(".claude", "permissions.json");

function createDefaultPaths(overrides?: Partial<PermissionStorePaths>): PermissionStorePaths {
  return {
    projectRoot: overrides?.projectRoot ?? process.cwd(),
    homeDir: overrides?.homeDir ?? os.homedir(),
  };
}

function resolveScopedStorePath(
  scope: Exclude<PermissionScope, "session">,
  paths: PermissionStorePaths,
): string {
  if (scope === "project") {
    return path.join(paths.projectRoot, PROJECT_RELATIVE_PATH);
  }

  return path.join(paths.homeDir, GLOBAL_RELATIVE_PATH);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeEntry(raw: PermissionEntry): PermissionEntry {
  return {
    id: raw.id,
    tool: raw.tool,
    pattern: raw.pattern,
    decision: raw.decision,
    scope: raw.scope,
    createdAt: raw.createdAt,
    expiresAt: raw.expiresAt ?? null,
  };
}

function isPermissionDecision(value: unknown): value is PermissionDecision {
  return value === "allow" || value === "deny";
}

function isPermissionScope(value: unknown): value is PermissionScope {
  return value === "session" || value === "project" || value === "global";
}

function readDocumentContent(content: string, sourcePath: string): PermissionStoreDocument {
  const parsed: unknown = JSON.parse(content);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`PERM_STORE_INVALID_DOCUMENT: ${sourcePath}`);
  }

  const record = parsed as Partial<PermissionStoreDocument>;
  if (record.version !== PERMISSION_STORE_VERSION) {
    throw new Error(
      `PERM_STORE_UNSUPPORTED_VERSION: ${sourcePath} (version=${String(record.version)})`,
    );
  }

  if (!Array.isArray(record.entries)) {
    throw new Error(`PERM_STORE_INVALID_ENTRIES: ${sourcePath}`);
  }

  const entries: PermissionEntry[] = [];
  for (const item of record.entries) {
    if (typeof item !== "object" || item === null) {
      continue;
    }

    const candidate = item as Partial<PermissionEntry>;
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.tool !== "string" ||
      typeof candidate.pattern !== "string" ||
      !isPermissionDecision(candidate.decision) ||
      !isPermissionScope(candidate.scope) ||
      typeof candidate.createdAt !== "string"
    ) {
      continue;
    }

    entries.push(
      normalizeEntry({
        id: candidate.id,
        tool: candidate.tool,
        pattern: candidate.pattern,
        decision: candidate.decision,
        scope: candidate.scope,
        createdAt: candidate.createdAt,
        expiresAt: candidate.expiresAt ?? null,
      }),
    );
  }

  return {
    version: PERMISSION_STORE_VERSION,
    entries,
  };
}

async function loadScopeEntries(
  scope: Exclude<PermissionScope, "session">,
  paths: PermissionStorePaths,
): Promise<PermissionEntry[]> {
  const storePath = resolveScopedStorePath(scope, paths);
  if (!(await pathExists(storePath))) {
    return [];
  }

  const content = await fs.readFile(storePath, "utf8");
  const document = readDocumentContent(content, storePath);
  return document.entries.map(normalizeEntry);
}

async function atomicWriteStoreDocument(
  scope: Exclude<PermissionScope, "session">,
  entries: PermissionEntry[],
  paths: PermissionStorePaths,
): Promise<void> {
  const storePath = resolveScopedStorePath(scope, paths);
  const directory = path.dirname(storePath);
  await fs.mkdir(directory, { recursive: true });

  const payload = JSON.stringify(
    {
      version: PERMISSION_STORE_VERSION,
      entries: entries.map(normalizeEntry),
    },
    null,
    2,
  );
  const tmpPath = `${storePath}.tmp-${process.pid}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
  await fs.writeFile(tmpPath, `${payload}\n`, "utf8");
  await fs.rename(tmpPath, storePath);
}

export function createPermissionStore(overrides?: Partial<PermissionStorePaths>): PermissionStore {
  const paths = createDefaultPaths(overrides);

  return {
    async list(scope) {
      if (!scope || scope === "session") {
        const [projectEntries, globalEntries] = await Promise.all([
          loadScopeEntries("project", paths),
          loadScopeEntries("global", paths),
        ]);
        return [...projectEntries, ...globalEntries];
      }

      return loadScopeEntries(scope, paths);
    },

    async upsert(input) {
      if (input.scope === "session") {
        throw new Error("PERM_STORE_SCOPE_NOT_PERSISTED: session");
      }

      const nowIso = input.createdAt ?? new Date().toISOString();
      const next: PermissionEntry = normalizeEntry({
        id: input.id ?? randomUUID(),
        tool: input.tool,
        pattern: input.pattern,
        decision: input.decision,
        scope: input.scope,
        createdAt: nowIso,
        expiresAt: input.expiresAt ?? null,
      });

      const existing = await loadScopeEntries(input.scope, paths);
      const byId = existing.findIndex((entry) => entry.id === next.id);
      if (byId >= 0) {
        existing[byId] = next;
      } else {
        const byPattern = existing.findIndex(
          (entry) =>
            entry.pattern === next.pattern &&
            entry.tool === next.tool &&
            entry.decision === next.decision,
        );
        if (byPattern >= 0) {
          existing[byPattern] = { ...next, id: existing[byPattern].id };
        } else {
          existing.push(next);
        }
      }

      await atomicWriteStoreDocument(input.scope, existing, paths);
      return next;
    },

    async revoke(pattern, scope) {
      const targetScopes: Array<Exclude<PermissionScope, "session">> =
        !scope || scope === "session" ? ["project", "global"] : [scope];

      let removed = 0;
      for (const targetScope of targetScopes) {
        const entries = await loadScopeEntries(targetScope, paths);
        const kept = entries.filter((entry) => entry.pattern !== pattern);
        const delta = entries.length - kept.length;
        if (delta > 0) {
          removed += delta;
          await atomicWriteStoreDocument(targetScope, kept, paths);
        }
      }

      return removed;
    },

    async clearExpired(nowIso = new Date().toISOString(), scope) {
      const nowMs = Date.parse(nowIso);
      const targetScopes: Array<Exclude<PermissionScope, "session">> =
        !scope || scope === "session" ? ["project", "global"] : [scope];
      let removed = 0;

      for (const targetScope of targetScopes) {
        const entries = await loadScopeEntries(targetScope, paths);
        const kept = entries.filter((entry) => {
          if (!entry.expiresAt) {
            return true;
          }

          const expiresMs = Date.parse(entry.expiresAt);
          if (Number.isNaN(expiresMs)) {
            return true;
          }

          return expiresMs > nowMs;
        });

        const delta = entries.length - kept.length;
        if (delta > 0) {
          removed += delta;
          await atomicWriteStoreDocument(targetScope, kept, paths);
        }
      }

      return removed;
    },
  };
}

