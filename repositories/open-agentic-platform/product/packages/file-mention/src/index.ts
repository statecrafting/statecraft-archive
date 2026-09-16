/**
 * @opc/file-mention — @-mention autocomplete for files and agents (058).
 */

// Types
export type {
  FileCandidate,
  AgentCandidate,
  MentionCandidate,
  FuzzyMatch,
  AgentInfo,
  MentionIndex,
  MentionState,
  MentionToken,
  ScannerOptions,
  FileChangeKind,
  FileChangeEvent,
  FileChangeHandler,
  FileAttachment,
  MentionMessage,
} from "./types.js";

// File tree
export { scanFileTree, filesToCandidates, parseGitignorePatterns, loadGitignore } from "./file-tree/scanner.js";
export { FileWatcher, connectWatcherToIndex } from "./file-tree/watcher.js";
export type { WatcherOptions } from "./file-tree/watcher.js";

// Fuzzy
export { MentionSearchIndex } from "./fuzzy/engine.js";
export { fuzzyScore, scoreFilePath, scoreAgent } from "./fuzzy/scoring.js";

// Mention trigger
export { createMentionTrigger, findTriggerAt } from "./mention/trigger.js";

// Tokens
export {
  createToken,
  tokenToText,
  parseTokensFromText,
  readFileAttachment,
  resolveMessage,
} from "./mention/token.js";

// Routing
export { MentionRouter } from "./mention/routing.js";
export type { AgentMessageHandler, AgentSource, RouterOptions } from "./mention/routing.js";

// UI
export {
  dropdownReducer,
  getSelection,
  initialDropdownState,
  keyToAction,
} from "./ui/dropdown.js";
export type { DropdownState, DropdownAction, DropdownSelection } from "./ui/dropdown.js";
export { highlightText, candidateDisplayText } from "./ui/highlight.js";
export type { HighlightSegment } from "./ui/highlight.js";
