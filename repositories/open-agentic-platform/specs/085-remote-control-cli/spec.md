---
id: "085-remote-control-cli"
title: "Remote Control CLI (oap-ctl)"
feature_branch: "feat/085-remote-control-cli"
status: approved
implementation: complete
kind: product
domain: opc
created: "2026-04-08"
authors:
  - "open-agentic-platform"
language: en
summary: >
  Exposes a localhost HTTP control API from the OPC desktop app and provides a
  zero-dependency Node.js CLI (oap-ctl) to drive it. Enables headless automation,
  scripting, and CI integration against a running desktop instance.
code_aliases:
  - OAP_CTL
  - CONTROL_API
sources:
  - claudepal
establishes:
  - unit: { kind: file, path: product/packages/oap-ctl/src/cli.js }
extends:
  - spec: "032-opc-inspect-governance-wiring-mvp"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src-tauri/src/web_server.rs }
---

# 085 — Remote Control CLI (oap-ctl)

## Purpose

The OPC desktop app has a rich set of Tauri commands and an internal web server,
but no external control surface. Users cannot script interactions, automate
workflows from CI, or integrate with external tools without the desktop UI.

This spec adds a token-authenticated localhost HTTP control API to the existing
web server and a standalone `oap-ctl` Node.js CLI that reads connection details
from well-known files, enabling headless operation against a running desktop
instance.

## Scope

### In Scope

- Control auth infrastructure: token generation, lockfile write/cleanup
- Control routes nested under `/control/*` with token validation middleware
- Routes: list projects, list/create sessions, send messages, cancel, status
- `oap-ctl` Node.js CLI package with zero runtime dependencies
- Lockfile convention: `~/.oap/control.port` and `~/.oap/control.token`

### Out of Scope

- Remote (non-localhost) access or TLS termination
- Authentication beyond localhost token
- Desktop UI changes
- Modifications to existing Tauri commands (control routes delegate to them)

## Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-001 | On web server startup, generate a random token (`Uuid::new_v4`) and write `~/.oap/control.port` and `~/.oap/control.token` with 0600 permissions |
| FR-002 | On shutdown, remove both control files |
| FR-003 | All `/control/*` routes validate `X-Control-Token` header; return 401 on mismatch |
| FR-004 | `GET /control/status` returns health check + version |
| FR-005 | `GET /control/projects` returns project list |
| FR-006 | `GET /control/projects/:id/sessions` returns sessions for a project |
| FR-007 | `POST /control/sessions` creates a new session |
| FR-008 | `POST /control/sessions/:id/messages` sends a prompt to a session |
| FR-009 | `DELETE /control/sessions/:id` cancels execution |
| FR-010 | `oap-ctl` CLI reads lockfiles and provides subcommands: `status`, `projects`, `sessions`, `send`, `create`, `cancel` |
| FR-011 | `oap-ctl` provides clear error messages for: desktop not running (missing files), connection refused, stale token (401) |

## Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NF-001 | Control API is localhost-only — no external network exposure |
| NF-002 | `oap-ctl` has zero npm dependencies — uses Node.js built-in `http` module |
| NF-003 | Token is ephemeral per desktop session — not persisted across restarts |
| NF-004 | Control routes use existing `ApiResponse<T>` wrapper for consistent JSON responses |

## Key Files

| File | Role |
|------|------|
| `product/apps/opc/src-tauri/src/web_server.rs` | Control server infra + auth middleware + routes |
| `product/packages/oap-ctl/package.json` | New CLI package |
| `product/packages/oap-ctl/src/cli.js` | New CLI entry point (~200 lines) |

## Verification

- Desktop app start: `~/.oap/control.port` and `~/.oap/control.token` created
- `oap-ctl status` returns JSON with version
- `oap-ctl projects` returns project list
- `oap-ctl send "hello"` delivers prompt to active session
- Desktop app quit: control files removed
- Missing desktop: `oap-ctl status` prints "desktop app not running"
