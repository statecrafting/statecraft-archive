---
id: "059-git-panel"
title: "Comprehensive Git Panel"
feature_branch: "059-git-panel"
status: approved
implementation: complete
kind: ui
domain: opc
created: "2026-03-29"
authors:
  - "open-agentic-platform"
language: en
summary: >
  Full-featured git panel showing staged/unstaged files, branch management,
  commit history with expandable inline diffs, and AI-generated commit messages.
  Uses optimized git plumbing commands (diff-files, diff-index, ls-files) for
  fast status retrieval instead of porcelain commands.
code_aliases:
  - GIT_PANEL
establishes:
  - unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/git.rs }
references:
  - role: historical
    unit: { kind: file, path: product/apps/opc/src/components/GitPanel.tsx }
---

# Feature Specification: Comprehensive Git Panel

## Purpose

Users working with AI coding assistants need tight git integration to review changes, stage files, commit, and manage branches without leaving the application. The claudecodeui and crystal consolidation sources each implement partial git UIs — claudecodeui has basic diff viewing while crystal wraps git porcelain commands — but neither provides a complete panel with staging controls, branch management, commit history, or AI-assisted commit messages. Porcelain commands like `git status` are also slow in large repositories.

This feature introduces a comprehensive git panel that covers the full staging-commit-history workflow, powered by fast git plumbing commands and enhanced with AI-generated commit messages.

## Scope

### In scope

- **File status view**: List of staged, unstaged (modified, deleted, renamed), and untracked files with clear visual grouping.
- **Staging controls**: Stage/unstage individual files, hunks, or all changes with single-click or keyboard shortcuts.
- **Inline diffs**: Expandable unified diffs for each changed file, rendered with syntax highlighting.
- **Commit interface**: Commit message input with AI-generated message suggestions, amend support, and sign-off options.
- **AI commit messages**: One-click generation of commit messages based on staged diffs, using the active agent provider.
- **Branch management**: Current branch display, branch switching, branch creation, and upstream tracking status.
- **Commit history**: Scrollable log of recent commits with author, date, message, and expandable diffs.
- **Optimized git backend**: Use git plumbing commands (`diff-files`, `diff-index`, `ls-files`, `rev-parse`, `for-each-ref`) instead of porcelain commands for faster status retrieval.

### Out of scope

- **Merge conflict resolution UI**: Visual three-way merge editing is a separate feature.
- **Interactive rebase**: Rebase workflows with commit reordering, squashing, and editing are deferred.
- **Remote operations**: Push, pull, and fetch are deferred to a follow-on feature; this panel focuses on local operations.
- **Git blame**: Per-line annotation view is a separate feature.
- **Submodule management**: Submodule status and operations are out of scope.

## Requirements

### Functional

- **FR-001**: The git panel displays three file groups: staged changes, unstaged changes, and untracked files, each with a file count badge.
- **FR-002**: Clicking a file in any group expands an inline unified diff with syntax-highlighted additions and deletions.
- **FR-003**: Each unstaged or untracked file has a "stage" action; each staged file has an "unstage" action. A "stage all" / "unstage all" control exists for each group.
- **FR-004**: Hunk-level staging is supported: within an expanded diff, individual hunks can be staged or unstaged independently.
- **FR-005**: The commit input area accepts a multi-line commit message. Pressing a configurable shortcut (default: Cmd/Ctrl+Enter) creates the commit.
- **FR-006**: An "AI Message" button generates a commit message from the currently staged diff by sending it to the active LLM provider. The generated message populates the input and can be edited before committing.
- **FR-007**: The panel header shows the current branch name, ahead/behind counts relative to the upstream branch, and a branch switcher dropdown.
- **FR-008**: The branch switcher lists local branches, allows creating a new branch from the current HEAD, and switches branches (with dirty-tree warnings).
- **FR-009**: A commit history section shows the most recent 50 commits (lazy-loaded) with abbreviated hash, author, relative date, and first line of the commit message.
- **FR-010**: Clicking a commit in the history expands it to show the full message and a file list with expandable diffs.
- **FR-011**: File status retrieval uses `git diff-files` (unstaged), `git diff-index --cached HEAD` (staged), and `git ls-files --others --exclude-standard` (untracked) instead of `git status`.
- **FR-012**: The panel auto-refreshes on file system change events and after git operations (commit, stage, branch switch).

### Non-functional

- **NF-001**: Status retrieval completes in < 200ms for repositories with up to 100,000 tracked files.
- **NF-002**: Diff rendering for a file with up to 5,000 changed lines completes in < 100ms.
- **NF-003**: AI commit message generation returns a result in < 3 seconds for typical staged diffs (under 10,000 tokens).
- **NF-004**: The panel consumes < 50MB additional memory for repositories with up to 1,000 changed files.

## Architecture

### Git status model

```typescript
interface GitFileStatus {
  path: string;                       // Relative to repo root
  oldPath?: string;                   // For renames
  status: "added" | "modified" | "deleted" | "renamed" | "copied" | "untracked";
  staged: boolean;
}

interface GitStatus {
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  staged: GitFileStatus[];
  unstaged: GitFileStatus[];
  untracked: GitFileStatus[];
}

interface GitCommit {
  hash: string;
  abbreviatedHash: string;
  author: string;
  authorEmail: string;
  date: number;                       // Unix timestamp
  message: string;
  parentHashes: string[];
}
```

### Git plumbing backend

```typescript
interface GitBackend {
  /** Fast status using plumbing commands. */
  status(): Promise<GitStatus>;

  /** Unified diff for a single file. */
  diff(path: string, staged: boolean): Promise<string>;

  /** Stage a file or specific hunks. */
  stage(path: string, hunks?: HunkRange[]): Promise<void>;

  /** Unstage a file or specific hunks. */
  unstage(path: string, hunks?: HunkRange[]): Promise<void>;

  /** Create a commit with the given message. */
  commit(message: string, options?: { amend?: boolean; signoff?: boolean }): Promise<GitCommit>;

  /** Recent commit log. */
  log(limit: number, offset?: number): Promise<GitCommit[]>;

  /** Diff for a specific commit. */
  commitDiff(hash: string): Promise<string>;

  /** List local branches. */
  branches(): Promise<BranchInfo[]>;

  /** Switch to a branch. */
  checkout(branch: string): Promise<void>;

  /** Create a new branch from HEAD. */
  createBranch(name: string): Promise<void>;
}

interface HunkRange {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

interface BranchInfo {
  name: string;
  isCurrent: boolean;
  upstream?: string;
  lastCommitHash: string;
  lastCommitDate: number;
}
```

### Plumbing command mapping

```
Operation           | Plumbing command
--------------------|---------------------------------------------
Unstaged changes    | git diff-files --name-status
Staged changes      | git diff-index --cached --name-status HEAD
Untracked files     | git ls-files --others --exclude-standard
File diff (unstaged)| git diff-files -p <path>
File diff (staged)  | git diff-index --cached -p HEAD -- <path>
Branch info         | git rev-parse --abbrev-ref HEAD
Ahead/behind        | git rev-list --left-right --count HEAD...@{u}
Branch list         | git for-each-ref --format=... refs/heads/
Commit log          | git log --format=... -n <limit>
Commit diff         | git diff-tree -p <hash>
```

### Package structure

```
packages/git-panel/
  src/
    index.ts                          -- Public API
    types.ts                          -- GitStatus, GitCommit, BranchInfo, etc.
    backend/
      plumbing.ts                     -- Git plumbing command execution
      parser.ts                       -- Parse plumbing output into typed models
      diff-parser.ts                  -- Unified diff parsing into hunk structures
    operations/
      staging.ts                      -- Stage/unstage file and hunk operations
      commit.ts                       -- Commit creation with options
      branch.ts                       -- Branch list, switch, create
    ai/
      commit-message.ts              -- AI commit message generation
    ui/
      GitPanel.tsx                    -- Main panel component
      FileStatusList.tsx              -- Grouped file list with status icons
      DiffView.tsx                    -- Syntax-highlighted inline diff
      CommitInput.tsx                 -- Message input with AI generate button
      BranchSwitcher.tsx              -- Branch dropdown with create option
      CommitHistory.tsx               -- Scrollable commit log with expand
```

### Data flow

```
FS change event or git operation
  |
  v
GitBackend.status() (plumbing commands)
  |
  v
Parse output -> GitStatus model
  |
  v
GitPanel renders:
  +-- Staged files group (with unstage actions)
  +-- Unstaged files group (with stage actions)
  +-- Untracked files group (with stage actions)
  +-- Commit input (with AI message button)
  +-- Branch header (with switcher)
  +-- Commit history (lazy-loaded)

User clicks "AI Message":
  |
  v
Read staged diff -> send to LLM provider -> populate commit input

User clicks file -> expand inline diff
User stages/unstages -> GitBackend.stage/unstage() -> refresh status
User commits -> GitBackend.commit() -> refresh status + history
```

## Implementation approach

1. **Phase 1 -- plumbing backend**: Implement the git plumbing command execution layer with typed parsers for status, diff, log, and branch output.
2. **Phase 2 -- file status UI**: Build the three-group file status list with stage/unstage actions and file count badges.
3. **Phase 3 -- inline diffs**: Add expandable unified diff rendering with syntax highlighting for changed files.
4. **Phase 4 -- commit interface**: Build the commit message input with Cmd/Ctrl+Enter shortcut and amend/sign-off options.
5. **Phase 5 -- AI commit messages**: Integrate with the provider registry to generate commit messages from staged diffs.
6. **Phase 6 -- branch management**: Add branch header with current branch display, ahead/behind counts, branch switcher, and branch creation.
7. **Phase 7 -- commit history**: Build the scrollable commit log with expandable commit details and diffs.
8. **Phase 8 -- hunk staging**: Add hunk-level staging controls within expanded diffs.

## Success criteria

- **SC-001**: The git panel correctly displays staged, unstaged, and untracked files matching `git status` output.
- **SC-002**: Staging and unstaging a file via the panel updates the git index and refreshes the panel within 200ms.
- **SC-003**: Expanding a file shows a syntax-highlighted unified diff matching `git diff` output.
- **SC-004**: Clicking "AI Message" with staged changes produces a relevant commit message within 3 seconds.
- **SC-005**: Creating a commit via the panel results in a valid git commit with the entered message.
- **SC-006**: The branch switcher lists all local branches and successfully switches branches (with a warning if the tree is dirty).
- **SC-007**: Status retrieval using plumbing commands is at least 2x faster than `git status --porcelain` in a repository with 50,000+ tracked files.
- **SC-008**: Hunk-level staging correctly stages only the selected hunk, verified by `git diff --cached`.

## Dependencies

| Spec | Relationship |
|------|-------------|
| 042-multi-provider-agent-registry | AI commit message generation uses the provider registry to access the active LLM |
| 057-notification-system | Commit success/failure events can be routed through the notification orchestrator |

## Risk

- **R-001**: Git plumbing output formats may vary across git versions. Mitigation: test against git 2.30+ (widely deployed baseline); parse defensively with fallback to porcelain commands.
- **R-002**: Large diffs (10,000+ lines) may cause UI performance issues. Mitigation: virtualize the diff view; render only visible lines; collapse large diffs by default with a "show all" toggle.
- **R-003**: AI-generated commit messages may not follow project-specific conventions. Mitigation: include recent commit messages as few-shot examples in the generation prompt; allow user editing before committing.
- **R-004**: Branch switching with a dirty working tree can cause data loss. Mitigation: always warn before switching with uncommitted changes; offer to stash changes automatically.
