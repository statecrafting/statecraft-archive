---
id: "086-open-source-launch"
title: "Open Source Launch Readiness"
feature_branch: "feat/086-open-source-launch"
status: approved
implementation: deferred
kind: process
domain: substrate
created: "2026-04-08"
amended: "2026-06-01"
amendment_record: "193-paired-release-cadence"
authors:
  - "open-agentic-platform"
language: en
summary: >
  Prepares the repository for public open source release with governance
  documents (CONTRIBUTING, SECURITY, CODE_OF_CONDUCT), a comprehensive
  architecture guide, a changelog, and a v0.1.0 release tag. Establishes the
  narrative that OAP is a governed AI delivery platform built with its own
  spec-first methodology.
code_aliases:
  - OPEN_SOURCE
  - OSS_LAUNCH
establishes:
  - unit: { kind: file, path: docs/ARCHITECTURE.md }
references:
  - role: planned
    unit: { kind: file, path: CONTRIBUTING.md }
  - role: planned
    unit: { kind: file, path: SECURITY.md }
  - role: planned
    unit: { kind: file, path: CODE_OF_CONDUCT.md }
  - role: planned
    unit: { kind: file, path: CHANGELOG.md }
---

> **Deferred** — partial progress has landed (`docs/ARCHITECTURE.md` is
> authored, `README.md` is current, tags `v0.2.1` and `v0.2.2` exist),
> but the remaining deliverables are all external-audience surface:
> `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`,
> and the `v0.1.0` GitHub Release. The repository is pre-alpha / stealth
> with no external contributors per `README.md`, so these docs would go
> stale before they are read. Resume the remaining deliverables when
> the repo is prepared for a public announcement or the first external
> contributor is onboarded. The acceptance criteria below remain the
> definition of done.

# 086 — Open Source Launch Readiness

> **Amended by [193-paired-release-cadence](../193-paired-release-cadence/spec.md) (2026-06-01).**
> `release-tools.yml` (which attaches the CLI-tool archives) now keys its
> `workflow_run` gate on the `opc-v` tag prefix and participates in the
> version-consistency guard. The launch-readiness scope here is unchanged.

## Purpose

OAP has 80+ specs delivered with a proven spec-first methodology, but lacks the
standard governance and onboarding documents expected of an open source project.
Without CONTRIBUTING.md, SECURITY.md, and CODE_OF_CONDUCT.md, external
contributors have no clear entry point. Without docs/ARCHITECTURE.md, the
three-layer system (OPC + Spec Spine + Platform) and Factory pipeline are
undocumented for newcomers. Without a CHANGELOG and release tag, there is no
milestone marker.

## Scope

### In Scope

- `CONTRIBUTING.md` — spec-first workflow, PR conventions, Claude Code workflows
- `SECURITY.md` — vulnerability reporting, supported versions, agent security model
- `CODE_OF_CONDUCT.md` — Contributor Covenant v2.1
- `docs/ARCHITECTURE.md` — three-layer diagram, crate map, Factory pipeline,
  orchestrator, platform services, Claude Code integration
- `CHANGELOG.md` — milestone summary from git history
- `README.md` enhancement — CI/license badges, Claude-native section, governance links
- `v0.1.0` release tag and GitHub Release

### Out of Scope

- API documentation generation
- Package publishing (crates.io, npm)
- CI/CD pipeline changes (covered by operational maintenance)
- Marketing website or landing page

## Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-001 | CONTRIBUTING.md covers: welcome, prerequisites, spec-first workflow, PR process, Claude Code workflows, review expectations |
| FR-002 | SECURITY.md covers: supported versions (pre-1.0 policy), vulnerability reporting via GitHub advisories, response timeline, agent security note |
| FR-003 | CODE_OF_CONDUCT.md adopts Contributor Covenant v2.1 |
| FR-004 | docs/ARCHITECTURE.md includes: three-layer system diagram, Rust crate dependency map, Factory two-phase pipeline, orchestrator dispatch model, platform services overview |
| FR-005 | CHANGELOG.md summarizes major milestones derived from git history |
| FR-006 | README.md updated with badges, Claude-native development section, and links to governance docs |
| FR-007 | Git tag `v0.1.0` created on main after all docs land |
| FR-008 | GitHub Release created with notes highlighting spec-first methodology and `.claude/` differentiator |

## Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NF-001 | All governance docs follow standard open source conventions |
| NF-002 | Architecture doc uses Mermaid diagrams for GitHub rendering |
| NF-003 | No duplication of content already in README.md or CLAUDE.md — link out instead |

## Verification

- All 4 governance files exist at repo root
- `docs/ARCHITECTURE.md` renders correctly on GitHub (Mermaid diagrams)
- `README.md` links to all governance docs
- `git tag -l v0.1.0` shows the tag
- GitHub Release exists with meaningful release notes
