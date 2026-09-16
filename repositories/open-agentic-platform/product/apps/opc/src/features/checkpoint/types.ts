/** Checkpoint metadata from axiomregent's checkpoint.* MCP tools. */
export interface CheckpointInfo {
  checkpoint_id: string;
  repo_root: string;
  parent_id: string | null;
  label: string | null;
  head_sha: string | null;
  fingerprint: string;
  state_hash: string;
  merkle_root: string;
  file_count: number;
  total_bytes: number;
  created_at: string; // ISO 8601
  metadata: string | null;
  /** Org context (spec 119). */
  org_id?: string | null;
  /** Git branch name at creation time (spec 095). */
  branch_name?: string | null;
  /** Orchestrator run ID (spec 095). */
  run_id?: string | null;
}

/** Compare result from checkpoint.compare (spec 095 Slice 4). */
export interface CheckpointCompare {
  checkpoint_a: string;
  checkpoint_b: string;
  files_added: number;
  files_modified: number;
  files_deleted: number;
  lines_added: number;
  lines_removed: number;
  merkle_roots_match: boolean;
  head_sha_a: string | null;
  head_sha_b: string | null;
  git_sha_comparison: string;
  branch_a: string | null;
  branch_b: string | null;
  /** Fingerprint of checkpoint A ({file_count, total_size, top_extensions}). */
  fingerprint_a?: Record<string, unknown> | null;
  /** Fingerprint of checkpoint B. */
  fingerprint_b?: Record<string, unknown> | null;
}

/** Alias used by the checkpoint flow. */
export type Checkpoint = CheckpointInfo;

/** Diff result from checkpoint.diff. */
export interface CheckpointDiff {
  from_checkpoint_id: string;
  to_checkpoint_id: string;
  added: string[];
  modified: string[];
  deleted: string[];
  file_diffs?: FileDiff[];
}

export interface FileDiff {
  path: string;
  hunks: string[];
}

/** Verification result from checkpoint.verify. */
export interface VerificationReport {
  checkpoint_id: string;
  ok: boolean;
  merkle_root_valid: boolean;
  corrupted_files: string[];
  missing_blobs: string[];
}
