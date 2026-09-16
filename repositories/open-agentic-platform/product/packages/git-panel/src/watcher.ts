/**
 * File system watcher for auto-refreshing git panel state.
 * FR-012: auto-refresh on FS changes and after git operations.
 */

import { watch, type FSWatcher } from "node:fs";
import type { GitPanelWatcher } from "./types.js";

export interface WatcherOptions {
  /** Debounce interval in ms. Default: 150. */
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 150;

/**
 * Create a file system watcher that triggers on changes within a repository.
 * Uses `fs.watch` with recursive option for efficient monitoring.
 */
export function createWatcher(
  repoRoot: string,
  options?: WatcherOptions,
): GitPanelWatcher {
  const debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const handlers = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let fsWatcher: FSWatcher | null = null;

  function notify(): void {
    for (const handler of handlers) {
      try {
        handler();
      } catch {
        // Swallow handler errors to avoid breaking the watcher
      }
    }
  }

  function scheduleNotify(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      notify();
    }, debounceMs);
  }

  try {
    fsWatcher = watch(repoRoot, { recursive: true }, (_event, filename) => {
      // Ignore changes inside .git directory except for refs/HEAD changes
      // which indicate branch switches, commits, etc.
      if (filename) {
        const normalized = filename.replace(/\\/g, "/");
        if (
          normalized.startsWith(".git/") &&
          !normalized.startsWith(".git/refs/") &&
          normalized !== ".git/HEAD" &&
          normalized !== ".git/index"
        ) {
          return;
        }
      }
      scheduleNotify();
    });

    // Unref the watcher so it doesn't prevent Node from exiting
    fsWatcher.unref();
  } catch {
    // Watching may fail on some platforms or permissions; proceed without it
  }

  return {
    onChange(handler: () => void): () => void {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },

    dispose(): void {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (fsWatcher) {
        fsWatcher.close();
        fsWatcher = null;
      }
      handlers.clear();
    },
  };
}

/**
 * Wrap a git operation to trigger a refresh after it completes.
 * Use this to wrap stage/unstage/commit/checkout calls.
 */
export function withRefresh<T>(
  operation: () => Promise<T>,
  refreshFn: () => void,
): Promise<T> {
  return operation().then(
    (result) => {
      refreshFn();
      return result;
    },
    (error) => {
      refreshFn();
      throw error;
    },
  );
}
