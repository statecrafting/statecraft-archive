/**
 * Feature 032 — T004/T005: typed git context panel (native git2 commands via Tauri).
 */

import type { GitStatusEntry } from '@/lib/bindings';

/** Snapshot shown when git queries succeed (full or partial). */
export interface GitContextData {
  repoPath: string;
  /** Current branch name, or `null` when detached HEAD. */
  branch: string | null;
  detached: boolean;
  ahead: number;
  behind: number;
  /** True when there is any staged or working-tree change. */
  workingTreeDirty: boolean;
  statusEntries: GitStatusEntry[];
  /** Whether upstream ahead/behind could be resolved. */
  upstreamResolved: boolean;
}

/** Additive GitHub context from axiomregent GitHub tools (never source-of-truth for local git). */
export interface GitCtxEnrichment {
  authenticated: boolean;
  status: string;
  repository:
    | {
        owner: string;
        name: string;
        full_name: string;
        default_branch: string | null;
        description: string | null;
        is_private: boolean;
      }
    | null;
  current_branch: string | null;
  current_path: string | null;
}

export type GitContextViewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: GitContextData }
  | { status: 'error'; message: string }
  /** Path is not a git repository (or missing). */
  | { status: 'unavailable'; message: string }
  /**
   * Repo opened but some data is missing (e.g. ahead/behind failed while branch/status ok).
   */
  | { status: 'degraded'; data: GitContextData; warnings: string[] };
