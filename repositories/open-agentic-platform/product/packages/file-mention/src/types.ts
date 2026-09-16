/**
 * Core types for the @-mention autocomplete system (058).
 */

// --- Candidate types ---

export interface FileCandidate {
  type: "file";
  relativePath: string;
  basename: string;
  icon: string;
}

export interface AgentCandidate {
  type: "agent";
  agentId: string;
  displayName: string;
  avatar: string;
}

export type MentionCandidate = FileCandidate | AgentCandidate;

// --- Fuzzy match ---

export interface FuzzyMatch {
  candidate: MentionCandidate;
  score: number;
  matchedRanges: Array<[start: number, end: number]>;
}

// --- Mention index ---

export interface AgentInfo {
  agentId: string;
  displayName: string;
  avatar: string;
}

export interface MentionIndex {
  search(query: string, limit?: number): FuzzyMatch[];
  rebuild(files: string[], agents: AgentInfo[]): void;
  addFile(relativePath: string): void;
  removeFile(relativePath: string): void;
}

// --- Mention trigger ---

export type MentionState =
  | { active: false }
  | {
      active: true;
      query: string;
      anchorPosition: number;
      candidates: FuzzyMatch[];
    };

// --- Mention token ---

export interface MentionToken {
  type: "file" | "agent";
  displayText: string;
  resolvedValue: string;
}

// --- Scanner options ---

export interface ScannerOptions {
  /** Project root directory (absolute path). */
  projectRoot: string;
  /** Additional ignore patterns beyond .gitignore. */
  extraIgnore?: string[];
  /** Maximum number of files to index. Defaults to 100_000. */
  maxFiles?: number;
}

// --- Watcher events ---

export type FileChangeKind = "create" | "delete" | "rename";

export interface FileChangeEvent {
  kind: FileChangeKind;
  relativePath: string;
  oldRelativePath?: string; // For renames
}

export type FileChangeHandler = (event: FileChangeEvent) => void;

// --- File content attachment ---

export interface FileAttachment {
  relativePath: string;
  absolutePath: string;
  content: string;
  truncated: boolean;
}

// --- Message with mentions ---

export interface MentionMessage {
  text: string;
  tokens: MentionToken[];
  fileAttachments: FileAttachment[];
  targetAgentId?: string;
}
