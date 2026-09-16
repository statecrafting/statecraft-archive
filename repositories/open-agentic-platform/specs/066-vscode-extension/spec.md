---
id: "066-vscode-extension"
title: "VS Code Extension (Sidebar Webview)"
feature_branch: "066-vscode-extension"
status: approved
implementation: deferred
kind: platform
domain: opc
created: "2026-03-31"
authors:
  - "open-agentic-platform"
language: en
summary: >
  VS Code extension that embeds an OAP panel as a sidebar webview. Uses a
  lockfile-based REST API for lightweight communication with the desktop app
  or a local agent server. Provides governance status, session management,
  and spec context directly in the IDE without requiring the full desktop app.
code_aliases:
  - VSCODE_EXT
sources:
  - claudepal
references:
  - role: deferred
    unit: { kind: directory, path: product/packages/vscode-extension }
---

> **Deferred** — the repository is pre-alpha / stealth with no external
> contributors or IDE users to serve. The spec is kept as approved
> direction so the REST-contract shape (`GET /governance/status`,
> `GET /sessions`, lockfile discovery, etc.) stays frozen against the
> desktop Tauri backend. Resume when either a second OAP surface needs
> to talk to the backend over that REST contract or an external
> developer audience materialises. No `packages/vscode-extension/`
> scaffold will be created in the meantime.

# Feature Specification: VS Code Extension (Sidebar Webview)

## Purpose

Developers spend most of their time in their IDE. Switching to the OAP desktop app to check governance status, view agent sessions, or access spec context breaks flow. A VS Code extension that surfaces OAP's key capabilities directly in the sidebar eliminates this context switch.

The extension embeds a webview panel in VS Code's sidebar that communicates with either the running OAP desktop app or a lightweight local agent server via a lockfile-based REST API. This keeps the extension thin (no bundled LLM logic) while giving developers immediate access to governance status, active sessions, spec lookup, and agent interaction without leaving their editor.

## Scope

### In scope

- **Sidebar webview panel**: A VS Code sidebar view container hosting a webview with OAP UI components.
- **Lockfile-based service discovery**: The desktop app (or local server) writes a lockfile containing its REST API port. The extension reads this lockfile to discover and connect to the backend.
- **REST API communication**: The extension communicates with the backend over HTTP for request/response operations and optionally SSE for streaming updates.
- **Governance status view**: Display current governance state — safety tier, coherence score, active policy violations — for the open workspace.
- **Session list and interaction**: List active agent sessions, view session output, send prompts to an active session.
- **Spec context panel**: Look up specs by ID or keyword, display spec summary and status for the feature being edited.
- **Workspace-aware context**: Automatically detect the workspace's git root and match it to OAP's project context.
- **Extension activation**: Activates when a workspace contains `.claude/` directory or `CLAUDE.md` file (OAP project markers).

### Out of scope

- **Embedded LLM execution**: The extension does not run agents itself; it delegates to the desktop app or local server.
- **Full desktop app feature parity**: The extension surfaces a focused subset — governance, sessions, specs. Full panel layout, git panel, etc. remain in the desktop app.
- **Extension marketplace publishing**: Initial release is a `.vsix` sideload. Marketplace publishing is a follow-on.
- **JetBrains / other IDE support**: VS Code only for the initial implementation.
- **Extension settings sync**: VS Code's built-in settings sync handles this; no custom sync needed.

## Requirements

### Functional

- **FR-001**: The extension registers a sidebar view container (`oap-sidebar`) in the Activity Bar with an OAP icon.
- **FR-002**: On activation, the extension searches for a lockfile at `~/.oap/server.lock` and `<workspace>/.oap/server.lock`. The lockfile contains JSON: `{ "pid": number, "port": number, "version": string, "startedAt": string }`.
- **FR-003**: If no lockfile is found or the process at `pid` is not running, the sidebar shows a "Not Connected" state with an option to start the OAP server.
- **FR-004**: The extension polls the lockfile location every 5 seconds when disconnected, auto-connecting when the backend becomes available.
- **FR-005**: The REST API base URL is `http://127.0.0.1:<port>/api/v1/`. All requests include a workspace identifier header (`X-OAP-Workspace: <git-root-path>`).
- **FR-006**: Governance status view calls `GET /governance/status` and displays: safety tier (with color indicator), coherence score (with privilege level), active violation count, and last evaluation timestamp.
- **FR-007**: Session list view calls `GET /sessions` and displays active sessions with: session ID, start time, status (running/paused/complete), and current task description.
- **FR-008**: Clicking a session opens a session detail panel showing streaming output. The extension subscribes to `GET /sessions/:id/stream` (SSE) for real-time updates.
- **FR-009**: A prompt input at the bottom of the session detail panel sends user messages via `POST /sessions/:id/messages` with body `{ "content": string }`.
- **FR-010**: Spec context view calls `GET /specs?q=<query>` for search and `GET /specs/:id` for detail. Displays spec title, status, summary, and requirements count.
- **FR-011**: The extension provides a "Show Spec for Current File" command that extracts `// Feature: FEATURE_ID` headers from the active editor file and navigates to the corresponding spec.
- **FR-012**: All webview content uses VS Code's theme CSS variables for consistent appearance across light/dark/high-contrast themes.
- **FR-013**: The extension contributes a status bar item showing connection status (connected/disconnected) and the current governance tier.

### Non-functional

- **NF-001**: Extension activation time < 200ms (lazy activation, no eager imports).
- **NF-002**: Webview initial render < 500ms after panel is shown.
- **NF-003**: Extension bundle size < 500KB (excluding webview assets).
- **NF-004**: REST API calls timeout after 5 seconds with a user-visible error.
- **NF-005**: The extension does not access the network beyond `127.0.0.1` — all communication is localhost only.

## Architecture

### Extension structure

```
packages/vscode-extension/
  package.json          -- VS Code extension manifest
  src/
    extension.ts        -- Activation, command registration, sidebar provider
    lockfile.ts         -- Lockfile discovery and parsing
    apiClient.ts        -- REST client for OAP backend
    sidebarProvider.ts  -- WebviewViewProvider implementation
    commands.ts         -- Command implementations (show spec, connect, etc.)
  webview/
    index.html          -- Webview shell
    main.ts             -- Webview entry point
    components/
      GovernanceStatus.ts
      SessionList.ts
      SessionDetail.ts
      SpecContext.ts
      ConnectionStatus.ts
  media/
    icon.svg            -- Activity bar icon
```

### Lockfile-based service discovery

```typescript
interface LockfileContent {
  pid: number;
  port: number;
  version: string;
  startedAt: string; // ISO 8601
}

const LOCKFILE_PATHS = [
  path.join(os.homedir(), ".oap", "server.lock"),
  path.join(workspaceRoot, ".oap", "server.lock"),
];

async function discoverBackend(): Promise<LockfileContent | null> {
  for (const lockPath of LOCKFILE_PATHS) {
    if (!fs.existsSync(lockPath)) continue;
    const content: LockfileContent = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
    // Verify process is alive
    try { process.kill(content.pid, 0); } catch { continue; }
    // Health check
    const ok = await fetch(`http://127.0.0.1:${content.port}/api/v1/health`);
    if (ok.status === 200) return content;
  }
  return null;
}
```

### REST API contract (backend must implement)

```
GET  /api/v1/health                    -> { status: "ok", version: string }
GET  /api/v1/governance/status         -> GovernanceStatus
GET  /api/v1/sessions                  -> Session[]
GET  /api/v1/sessions/:id              -> SessionDetail
GET  /api/v1/sessions/:id/stream       -> SSE stream of SessionEvent
POST /api/v1/sessions/:id/messages     -> { content: string } -> MessageAck
GET  /api/v1/specs?q=<query>           -> SpecSummary[]
GET  /api/v1/specs/:id                 -> SpecDetail
```

### Webview-extension message protocol

```typescript
// Extension -> Webview
type ExtToWebview =
  | { type: "state_update"; view: "governance" | "sessions" | "specs"; data: unknown }
  | { type: "connection_status"; connected: boolean; port?: number }
  | { type: "session_event"; sessionId: string; event: unknown }
  | { type: "theme_changed" };

// Webview -> Extension
type WebviewToExt =
  | { type: "ready" }
  | { type: "navigate"; view: string; params?: Record<string, string> }
  | { type: "send_message"; sessionId: string; content: string }
  | { type: "search_specs"; query: string }
  | { type: "refresh" };
```

### Theme integration

The webview HTML injects VS Code's theme CSS variables:

```html
<style>
  body {
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
  }
  .badge-full    { background: var(--vscode-testing-iconPassed); }
  .badge-restricted { background: var(--vscode-editorWarning-foreground); }
  .badge-readonly { background: var(--vscode-editorInfo-foreground); }
  .badge-suspended { background: var(--vscode-testing-iconFailed); }
</style>
```

## Implementation approach

1. **Phase 1 — extension scaffold**: Create `packages/vscode-extension/` with package.json manifest, activation logic, sidebar view container registration, and a placeholder webview. Verify activation on a workspace with `CLAUDE.md`.
2. **Phase 2 — lockfile discovery**: Implement lockfile parsing, process liveness check, health endpoint verification, and polling reconnection. Test with a mock lockfile.
3. **Phase 3 — REST API client**: Implement `apiClient.ts` with typed methods for all endpoints. Error handling with timeouts and retry for transient failures.
4. **Phase 4 — governance and spec views**: Build the governance status and spec context webview components. Wire to the API client. Test with mock API responses.
5. **Phase 5 — session interaction**: Build session list, session detail with SSE streaming, and prompt input. Wire to the API client.
6. **Phase 6 — commands and status bar**: Implement "Show Spec for Current File" command, status bar item, and theme-aware styling across light/dark/high-contrast.
7. **Phase 7 — backend API endpoints**: Implement the REST API endpoints in the desktop app's Tauri backend (or a standalone local server), including lockfile creation on startup.

## Success criteria

- **SC-001**: Opening a workspace containing `CLAUDE.md` shows the OAP icon in VS Code's Activity Bar. Clicking it opens the sidebar panel.
- **SC-002**: With the OAP backend running, the sidebar shows the current governance status (safety tier, coherence score) within 2 seconds of opening.
- **SC-003**: The session list displays active sessions and clicking one shows streaming output in real time.
- **SC-004**: Sending a message from the prompt input appears in the session and produces a response.
- **SC-005**: Running "Show Spec for Current File" on a file with `// Feature: 042-multi-provider-agent-registry` opens the spec detail view for that feature.
- **SC-006**: The sidebar renders correctly in VS Code light, dark, and high-contrast themes.
- **SC-007**: With no backend running, the sidebar shows "Not Connected" and auto-connects when the backend starts.

## Dependencies

| Spec | Relationship |
|------|-------------|
| 063-coherence-scoring | Governance status view displays coherence score and privilege level |
| 036-safety-tier-governance | Governance status view displays the current safety tier |
| 042-multi-provider-agent-registry | Sessions are managed by the provider registry |

## Risk

- **R-001**: Lockfile becomes stale if the backend crashes without cleanup. Mitigation: the extension verifies process liveness (`kill(pid, 0)`) and health endpoint before trusting the lockfile.
- **R-002**: VS Code webview security restrictions may limit what the webview can do (no direct filesystem access, limited networking). Mitigation: all data fetching happens in the extension host and is passed to the webview via message protocol.
- **R-003**: The REST API contract must be implemented in the backend, which is a significant dependency. Mitigation: Phase 7 is explicit; the extension can be developed and tested against a mock server first.
- **R-004**: Extension activation on every workspace with CLAUDE.md could be annoying for users who don't use OAP. Mitigation: activation is lazy (only registers the sidebar); no work is done until the user clicks the sidebar icon.
- **R-005**: SSE streaming through VS Code's extension host may have memory pressure for long-running sessions. Mitigation: implement a sliding window of displayed events with older events paged on demand.
