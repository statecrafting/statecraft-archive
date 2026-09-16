import fs from "node:fs";
import path from "node:path";
import { parseRuleSet } from "./parser.js";
import type { Diagnostic, Rule } from "./types.js";

/** Default rules directory relative to `process.cwd()`. */
export const DEFAULT_RULES_DIR = ".claude/hooks/rules";

export interface LoaderConfig {
  /** Directory containing `*.md` rule files (recursive). Default: {@link DEFAULT_RULES_DIR}. */
  rulesDir?: string;
}

/**
 * Immutable ruleset snapshot from a load pass. Replacing the snapshot is atomic;
 * callers who captured a prior snapshot keep evaluating against that ruleset (H-004).
 */
export interface RulesetSnapshot {
  readonly rules: readonly Rule[];
  readonly diagnostics: readonly Diagnostic[];
  /** `Date.now()` when the snapshot was built. */
  readonly loadedAt: number;
  /** Monotonically increasing per successful rebuild (including initial load). */
  readonly version: number;
}

function resolveRulesDir(rulesDir: string | undefined): string {
  const rel = rulesDir ?? DEFAULT_RULES_DIR;
  return path.resolve(rel);
}

/**
 * Recursively list `*.md` file paths under `rootDir`, sorted for deterministic loads.
 */
export function discoverMarkdownRuleFiles(rootDir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(rootDir)) {
    return out;
  }
  const st = fs.statSync(rootDir);
  if (!st.isDirectory()) {
    return out;
  }
  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(p);
      } else if (ent.isFile() && ent.name.endsWith(".md")) {
        out.push(p);
      }
    }
  }
  walk(rootDir);
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function listDirectoriesRecursive(rootDir: string): string[] {
  const dirs: string[] = [];
  if (!fs.existsSync(rootDir)) {
    return dirs;
  }
  const st = fs.statSync(rootDir);
  if (!st.isDirectory()) {
    return dirs;
  }
  function walk(dir: string): void {
    dirs.push(dir);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const p = path.join(dir, ent.name);
      walk(p);
    }
  }
  walk(rootDir);
  return dirs;
}

function readRuleFiles(filePaths: string[]): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];
  for (const p of filePaths) {
    try {
      const content = fs.readFileSync(p, "utf8");
      files.push({ path: p, content });
    } catch {
      // Race with delete between discover and read — skip file.
    }
  }
  return files;
}

let globalVersionSeq = 0;

function nextVersion(): number {
  globalVersionSeq += 1;
  return globalVersionSeq;
}

function buildSnapshotFromDir(rulesDir: string): RulesetSnapshot {
  const mdPaths = discoverMarkdownRuleFiles(rulesDir);
  const files = readRuleFiles(mdPaths);
  const parsed = parseRuleSet(files);
  return {
    rules: parsed.rules,
    diagnostics: parsed.diagnostics,
    loadedAt: Date.now(),
    version: nextVersion(),
  };
}

/**
 * One-shot synchronous load from disk (FR-008). Does not start file watching.
 */
export function loadRules(config: LoaderConfig = {}): RulesetSnapshot {
  const rulesDir = resolveRulesDir(config.rulesDir);
  return buildSnapshotFromDir(rulesDir);
}

export interface RuleRuntime {
  getRulesSnapshot(): RulesetSnapshot;
  /** Replace snapshot atomically from disk. */
  loadRules(): RulesetSnapshot;
  startHotReload(): void;
  stopHotReload(): void;
}

const RELOAD_DEBOUNCE_MS = 75;

/**
 * Long-lived runtime with atomic snapshot replacement and optional directory watching.
 * Hot-reload watches all subdirectories (Linux-safe; no reliance on `recursive` fs.watch).
 */
export function createRuleRuntime(config: LoaderConfig = {}): RuleRuntime {
  const rulesDir = resolveRulesDir(config.rulesDir);
  let snapshot: RulesetSnapshot = buildSnapshotFromDir(rulesDir);
  let watching = false;
  const watchers: fs.FSWatcher[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function rebuild(): RulesetSnapshot {
    snapshot = buildSnapshotFromDir(rulesDir);
    return snapshot;
  }

  function teardownWatchers(): void {
    for (const w of watchers) {
      try {
        w.close();
      } catch {
        // ignore
      }
    }
    watchers.length = 0;
  }

  function scheduleReload(): void {
    if (!watching) return;
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      rebuild();
      teardownWatchers();
      attachWatchers();
    }, RELOAD_DEBOUNCE_MS);
  }

  function attachWatchers(): void {
    if (!watching) return;
    const dirs = listDirectoriesRecursive(rulesDir);
    for (const dir of dirs) {
      try {
        const w = fs.watch(dir, () => {
          scheduleReload();
        });
        watchers.push(w);
      } catch {
        // Directory may have been removed between list and watch.
      }
    }
  }

  return {
    getRulesSnapshot(): RulesetSnapshot {
      return snapshot;
    },
    loadRules(): RulesetSnapshot {
      return rebuild();
    },
    startHotReload(): void {
      if (watching) return;
      watching = true;
      teardownWatchers();
      attachWatchers();
    },
    stopHotReload(): void {
      watching = false;
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      teardownWatchers();
    },
  };
}
