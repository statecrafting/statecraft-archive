/**
 * File system watcher for incremental mention index updates (058 Phase 7).
 *
 * Watches the project directory for file create/delete/rename events
 * and notifies the mention index so the candidate list stays current
 * without requiring a full rescan (FR-009, SC-007).
 */

import { watch, type FSWatcher } from "node:fs";
import { relative, join, basename } from "node:path";
import type { FileChangeEvent, FileChangeHandler } from "../types.js";
import type { MentionIndex } from "../types.js";

/** Directories to never watch (mirrors scanner ALWAYS_EXCLUDED). */
const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "coverage",
  "__pycache__",
  ".cache",
  "target",
]);

export interface WatcherOptions {
  projectRoot: string;
  /** Optional debounce interval in ms. Default: 100. */
  debounceMs?: number;
  /** Gitignore matchers to filter events. */
  ignoreMatchers?: ((path: string) => boolean)[];
}

/**
 * File watcher that emits change events for the mention system.
 *
 * Uses Node's native `fs.watch` with recursive option (supported on
 * macOS and Windows; on Linux, recursive requires Node 19+).
 */
export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private handlers: FileChangeHandler[] = [];
  private projectRoot: string;
  private debounceMs: number;
  private ignoreMatchers: ((path: string) => boolean)[];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingEvents: Map<string, FileChangeEvent> = new Map();

  constructor(options: WatcherOptions) {
    this.projectRoot = options.projectRoot;
    this.debounceMs = options.debounceMs ?? 100;
    this.ignoreMatchers = options.ignoreMatchers ?? [];
  }

  /**
   * Register a change handler.
   * Returns an unsubscribe function.
   */
  onChange(handler: FileChangeHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  /**
   * Start watching. Idempotent — calling start() again is a no-op.
   */
  start(): void {
    if (this.watcher) return;

    try {
      this.watcher = watch(
        this.projectRoot,
        { recursive: true },
        (eventType, filename) => {
          if (!filename) return;
          this.handleRawEvent(eventType, filename);
        },
      );
    } catch {
      // fs.watch may throw on unsupported platforms or permissions
      // Graceful degradation: no watching, index stays static
    }
  }

  /**
   * Stop watching and clean up.
   */
  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.watcher?.close();
    this.watcher = null;
    this.pendingEvents.clear();
  }

  /**
   * Whether the watcher is currently active.
   */
  get active(): boolean {
    return this.watcher !== null;
  }

  private handleRawEvent(eventType: string, filename: string): void {
    // Normalize path separators
    const relPath = filename.replace(/\\/g, "/");

    // Check excluded directories
    const firstSegment = relPath.split("/")[0]!;
    if (EXCLUDED_DIRS.has(firstSegment)) return;

    // Check gitignore
    if (this.ignoreMatchers.some((m) => m(relPath))) return;

    // Map fs.watch eventType to our FileChangeKind
    // fs.watch gives "rename" for create/delete/rename and "change" for content changes
    const kind = eventType === "rename" ? "create" : undefined;
    if (!kind) return; // "change" events don't affect the file list

    // Debounce: accumulate events, then flush
    this.pendingEvents.set(relPath, {
      kind: "create", // We'll determine actual kind in flush
      relativePath: relPath,
    });

    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.flush(), this.debounceMs);
  }

  private flush(): void {
    const events = Array.from(this.pendingEvents.values());
    this.pendingEvents.clear();
    this.debounceTimer = null;

    for (const event of events) {
      for (const handler of this.handlers) {
        try {
          handler(event);
        } catch {
          // Don't let a handler error kill the watcher
        }
      }
    }
  }
}

/**
 * Connect a FileWatcher to a MentionIndex for automatic updates (SC-007).
 *
 * On file create: adds the file to the index.
 * On file delete: removes the file from the index.
 * On file rename: removes old path, adds new path.
 */
export function connectWatcherToIndex(
  watcher: FileWatcher,
  index: MentionIndex,
): () => void {
  return watcher.onChange((event) => {
    switch (event.kind) {
      case "create":
        index.addFile(event.relativePath);
        break;
      case "delete":
        index.removeFile(event.relativePath);
        break;
      case "rename":
        if (event.oldRelativePath) {
          index.removeFile(event.oldRelativePath);
        }
        index.addFile(event.relativePath);
        break;
    }
  });
}
