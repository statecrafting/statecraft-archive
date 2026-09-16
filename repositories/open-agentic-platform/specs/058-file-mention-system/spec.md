---
id: "058-file-mention-system"
title: "@-Mention Autocomplete for Files and Agents"
feature_branch: "058-file-mention-system"
status: approved
implementation: complete
kind: ui
domain: opc
created: "2026-03-29"
authors:
  - "open-agentic-platform"
language: en
summary: >
  Autocomplete system for the chat composer that triggers on "@" to let users
  mention project files or target specific agents. Fetches the project file tree,
  flattens it to a searchable list, applies fuzzy filtering as the user types,
  and presents a keyboard-navigable dropdown. Agent @mentions route the message
  to the selected agent.
code_aliases:
  - FILE_MENTION
establishes:
  - unit: { kind: directory, path: product/packages/file-mention }
references:
  - role: historical
    unit: { kind: file, path: product/apps/opc/src/components/FileMentionAutocomplete.tsx }
  - role: historical
    unit: { kind: file, path: product/apps/opc/src/lib/fileMentionSystem.ts }
---

# Feature Specification: @-Mention Autocomplete for Files and Agents

## Purpose

Users frequently need to reference specific files or direct messages to specific agents in the chat composer. Today they must type full file paths manually (error-prone, slow) or hope the agent infers the right file from context. The claudecodeui and claude-code-by-agents consolidation sources both implement partial file reference mechanisms with no shared autocomplete infrastructure and no agent-mention routing.

This feature introduces a unified @-mention system in the chat composer that provides fuzzy-filtered autocomplete for both project files and registered agents, with keyboard navigation and automatic context attachment.

## Scope

### In scope

- **@ trigger detection**: The composer detects when the user types "@" and activates the autocomplete dropdown.
- **File tree fetching**: On project open, the file tree is fetched and flattened into a searchable list of relative paths.
- **Fuzzy filtering**: As the user types after "@", candidates are fuzzy-matched and ranked by relevance.
- **Keyboard navigation**: Arrow keys navigate the dropdown; Enter/Tab selects; Escape dismisses.
- **File mention tokens**: Selected files appear as styled tokens in the composer that resolve to absolute paths when the message is sent.
- **Agent @mentions**: Typing "@" also surfaces registered agents; selecting an agent routes the message to that specific agent.
- **File content attachment**: When a file mention is included in a sent message, the referenced file's content is automatically attached to the context.
- **Gitignore awareness**: The file tree respects `.gitignore` rules and excludes ignored files from the candidate list.

### Out of scope

- **Directory mentions**: Only individual files are mentionable; directory-level mentions (include all files in a folder) are deferred.
- **Symbol mentions**: Mentioning specific functions, classes, or symbols within a file is a separate feature.
- **Drag-and-drop file attachment**: File attachment via drag-and-drop is a separate interaction pattern.
- **Remote file references**: Only local project files are supported; remote URLs or cloud storage references are out of scope.

## Requirements

### Functional

- **FR-001**: Typing "@" in the chat composer opens an autocomplete dropdown within 100ms.
- **FR-002**: The dropdown displays up to 20 candidates, ordered by fuzzy match score against the text following "@".
- **FR-003**: Candidates include both project files (relative paths) and registered agents (display name with icon).
- **FR-004**: Fuzzy matching supports non-contiguous character matching (e.g., "@cmp" matches `src/components/Button.tsx`), path-segment matching, and basename boosting (matches in the filename score higher than matches in directory names).
- **FR-005**: Arrow Up/Down navigates candidates; Enter or Tab confirms selection; Escape closes the dropdown without selection.
- **FR-006**: A selected file appears as a styled inline token showing the basename with a file icon; hovering the token shows the full relative path.
- **FR-007**: A selected agent appears as a styled inline token with the agent's name and avatar; the message is routed to that agent on send.
- **FR-008**: When the message is sent, each file mention token causes the file's content to be read and attached to the message context.
- **FR-009**: The file tree is refreshed on file system change events (create, delete, rename) so the candidate list stays current.
- **FR-010**: Files matching `.gitignore` patterns and common exclusions (`node_modules`, `.git`, `dist`) are omitted from the candidate list.

### Non-functional

- **NF-001**: Fuzzy filtering completes in < 20ms for projects with up to 50,000 files.
- **NF-002**: File tree initial load completes in < 500ms for projects with up to 50,000 files.
- **NF-003**: The dropdown renders without visible jank or layout shift during filtering.

## Architecture

### Mention candidate types

```typescript
type MentionCandidate =
  | { type: "file"; relativePath: string; basename: string; icon: string }
  | { type: "agent"; agentId: string; displayName: string; avatar: string };
```

### Fuzzy match engine

```typescript
interface FuzzyMatch {
  candidate: MentionCandidate;
  score: number;           // Higher is better
  matchedRanges: Array<[start: number, end: number]>; // For highlight rendering
}

interface MentionIndex {
  search(query: string, limit?: number): FuzzyMatch[];
  rebuild(files: string[], agents: AgentInfo[]): void;
  addFile(relativePath: string): void;
  removeFile(relativePath: string): void;
}
```

### Composer integration

```typescript
interface MentionTrigger {
  /** Called on every keystroke in the composer. */
  onInput(text: string, cursorPosition: number): MentionState | null;
}

type MentionState =
  | { active: false }
  | {
      active: true;
      query: string;           // Text after "@"
      anchorPosition: number;  // Cursor position of the "@"
      candidates: FuzzyMatch[];
    };

interface MentionToken {
  type: "file" | "agent";
  displayText: string;         // Shown in the composer
  resolvedValue: string;       // Absolute path or agent id
}
```

### Package structure

```
packages/file-mention/
  src/
    index.ts                       -- Public API
    types.ts                       -- MentionCandidate, FuzzyMatch, MentionToken
    file-tree/
      scanner.ts                   -- Walk project tree, apply gitignore
      watcher.ts                   -- FS event listener for incremental updates
    fuzzy/
      engine.ts                    -- Fuzzy matching algorithm
      scoring.ts                   -- Score calculation with basename boost
    mention/
      trigger.ts                   -- @ detection and state management
      token.ts                     -- Token creation and resolution
      routing.ts                   -- Agent mention message routing
    ui/
      dropdown.tsx                 -- Autocomplete dropdown component
      token-chip.tsx               -- Inline token render component
```

### Interaction flow

```
User types "@bu" in composer
  |
  v
MentionTrigger.onInput() detects "@" prefix
  |
  v
MentionIndex.search("bu", 20)
  |
  v
Returns ranked matches:
  1. src/components/Button.tsx  (basename match)
  2. src/utils/buildConfig.ts   (basename match)
  3. @build-agent               (agent match)
  |
  v
Dropdown renders with highlighted match ranges
  |
  v
User presses Enter on "Button.tsx"
  |
  v
Token inserted: [@Button.tsx] (resolves to src/components/Button.tsx)
  |
  v
On send: file content of src/components/Button.tsx attached to message
```

## Implementation approach

1. **Phase 1 -- file tree scanner**: Build the project file tree walker with gitignore filtering and flatten to a list of relative paths.
2. **Phase 2 -- fuzzy engine**: Implement the fuzzy matching algorithm with path-segment awareness and basename boosting.
3. **Phase 3 -- mention trigger**: Detect "@" in the composer, extract the query, and wire into the fuzzy engine.
4. **Phase 4 -- dropdown UI**: Build the keyboard-navigable autocomplete dropdown with match highlighting.
5. **Phase 5 -- token insertion**: Implement inline token rendering in the composer and file content attachment on send.
6. **Phase 6 -- agent mentions**: Add registered agents to the candidate index and implement message routing when an agent is mentioned.
7. **Phase 7 -- file watching**: Add FS event watcher for incremental index updates on file create/delete/rename.

## Success criteria

- **SC-001**: Typing "@" in the composer opens a dropdown showing file and agent candidates within 100ms.
- **SC-002**: Typing "@btn" surfaces `Button.tsx` in the top 3 results for a typical React project.
- **SC-003**: Selecting a file inserts a styled token that, on hover, shows the full relative path.
- **SC-004**: Sending a message containing a file mention attaches that file's content to the agent context.
- **SC-005**: Selecting an agent mention routes the sent message to that specific agent.
- **SC-006**: Files inside `node_modules` and `.git` do not appear in the candidate list.
- **SC-007**: Creating a new file in the project makes it appear in autocomplete results without requiring a manual refresh.

## Dependencies

| Spec | Relationship |
|------|-------------|
| 042-multi-provider-agent-registry | Agent mentions route to agents spawned through the provider registry |
| 035-agent-governed-execution | File content attachment goes through governed execution for safety checks |

## Risk

- **R-001**: Very large monorepos (100k+ files) may cause slow initial tree scans. Mitigation: scan is async and non-blocking; the dropdown works with a partial index while the scan completes; common large directories are excluded early.
- **R-002**: Fuzzy matching may surface irrelevant files when the query is short (1-2 chars). Mitigation: require a minimum query length of 1 character after "@"; rank recently opened files higher.
- **R-003**: File content attachment for large files may exceed context limits. Mitigation: attach a truncated preview with a note indicating the file was truncated; let the agent request specific line ranges if needed.
