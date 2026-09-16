---
id: "100-post-convergence-remediation"
title: "Post-Convergence Remediation"
status: approved
implementation: complete
owner: bart
created: "2026-04-12"
kind: process
domain: substrate
risk: high
depends_on:
  - "089-governed-convergence-plan"
code_aliases: ["POST_CONVERGENCE_REMEDIATION"]
refines:
  - aspect: "security-hardening"
    unit: { kind: file, path: product/apps/opc/src-tauri/tauri.conf.json }
  - aspect: "security-hardening"
    unit: { kind: file, path: crates/factory-engine/src/artifact_store.rs }
  - aspect: "security-hardening"
    unit: { kind: file, path: crates/orchestrator/src/artifact.rs }
  - aspect: "security-hardening"
    unit: { kind: file, path: crates/policy-kernel/src/lib.rs }
  - aspect: "security-hardening"
    unit: { kind: file, path: platform/charts/statecraft/templates/deployment.yaml }
  - aspect: "security-hardening"
    unit: { kind: file, path: platform/charts/deployd-api/templates/deployment.yaml }
  - aspect: "security-hardening"
    unit: { kind: file, path: platform/services/deployd-api-rs/src/config.rs }
  - aspect: "security-hardening"
    unit: { kind: file, path: platform/services/deployd-api-rs/src/auth.rs }
summary: >
  Remediate security vulnerabilities, integrity gaps, and technical debt surfaced
  during codebase analysis after the governed convergence plan (089) completed.
  Four phases: critical security, high security and platform hardening, integrity
  and consistency, orphaned code feature catalog for UI reintegration.
---

# 100 — Post-Convergence Remediation

Parent plan: [089 Governed Convergence](../089-governed-convergence-plan/spec.md)

## Problem

A comprehensive codebase analysis after the governed convergence plan (specs 090–099)
completed surfaced 19 issues across security, integrity, and orphaned code:

- **2 critical**: live credentials in working tree, JWT validation silently disabled
- **6 high**: Tauri CSP with unsafe-eval, assetProtocol wildcard scope, unvalidated
  webview project_path, path traversal in artifact stores
- **4 medium**: Azure Key Vault purge protection disabled, blocking Mutex in async,
  policy-kernel unwrap panics, deployd temp data dir
- **7 integrity**: stale spec registry, spec-template missing frontmatter, dependency
  version drift (thiserror, axum), superseded specs missing backlinks, unquoted YAML
  dates, untracked desktop Cargo.lock

Additionally, 17 TypeScript packages in `product/packages/` have zero consumers but contain
fully implemented features (specs 050–071) ready for UI reintegration.

## Solution

Four-phase remediation ordered by blast radius.

### Phase 1 — Critical Security

| Slice | Issue | Files |
|-------|-------|-------|
| 1.1 | Remove live Hetzner .env credentials | `platform/infra/hetzner/.env` (delete), `.gitignore` |
| 1.2 | Require JWT audience + scope validation | `deployd-api-rs/src/config.rs`, `auth.rs` |

### Phase 2 — High Security + Platform Hardening

| Slice | Issue | Files |
|-------|-------|-------|
| 2.1 | Remove unsafe-eval from Tauri CSP, narrow assetProtocol | `tauri.conf.json` |
| 2.2 | Validate project_path from webview | `commands/agents.rs` |
| 2.3 | Path traversal guards in artifact stores | `factory-engine/artifact_store.rs`, `orchestrator/artifact.rs` |
| 2.4 | Azure Key Vault purge protection | `azure_core/main.tf` |
| 2.5 | Handle poisoned Mutex in JWKS cache | `deployd-api-rs/auth.rs` |
| 2.6 | Replace bare unwrap in policy-kernel | `policy-kernel/src/lib.rs` |
| 2.7 | Change deployd data dir from /tmp | `deployd-api-rs/main.rs` |
| 2.8 | Add K8s security contexts | `statecraft/deployment.yaml`, `deployd-api/deployment.yaml` |

### Phase 3 — Integrity & Consistency

| Slice | Issue | Files |
|-------|-------|-------|
| 3.1 | Add frontmatter to spec template | `standards/spec/templates/spec-template.md` |
| 3.2 | Create spec 100 | `specs/100-post-convergence-remediation/spec.md` |
| 3.3 | Upgrade thiserror 1.0 → 2 | `factory-contracts/Cargo.toml` |
| 3.4 | Upgrade axum 0.7 → 0.8 | `orchestrator/Cargo.toml` |
| 3.5 | Add superseded_by to specs 038, 040 | `specs/038-*/spec.md`, `specs/040-*/spec.md` |
| 3.6 | Quote YAML dates | `specs/087-*/spec.md`, `specs/088-*/spec.md` |
| 3.7 | Track desktop Cargo.lock | `.gitignore`, `product/apps/opc/src-tauri/Cargo.lock` |
| 3.8 | Recompile spec registry (096–100) | `.derived/spec-registry/registry.json` |

### Phase 4 — Orphaned Code Feature Catalog

17 packages cataloged by integration cluster for UI reintegration:

- **Agent execution backbone**: worktree-agents, notification-orchestrator
- **Governance layer**: hookify-rule-engine, coherence-scoring
- **Prompt construction**: prompt-assembly, session-memory, yaml-standards-schema
- **Chat UX**: file-mention, tool-renderer, panel-event-bus
- **Work management**: conductor-track, verification-profiles
- **Skill system**: agent-frontmatter, skill-command-factory
- **Remote control**: git-panel, oap-ctl, multi-model-chaining

## Acceptance Criteria

- AC-100-1: No live credentials exist in the working tree
- AC-100-2: deployd-api rejects JWTs without matching audience
- AC-100-3: Tauri CSP contains no unsafe-eval; assetProtocol scoped to app dirs
- AC-100-4: Artifact stores reject path traversal in content_hash and filename
- AC-100-5: All K8s deployments have runAsNonRoot and allowPrivilegeEscalation: false
- AC-100-6: Spec registry contains specs 096–100
- AC-100-7: spec-template.md produces V-001/V-002 compliant specs
- AC-100-8: No thiserror or axum version drift across workspace

## Implementation Status

All four phases landed in commit `a04f312` (2026-04-12). Evidence:

- **Phase 1.1** — `platform/infra/hetzner/.env` not present in working tree;
  `platform/infra/hetzner/.gitignore` excludes `.env`.
- **Phase 1.2** — `deployd-api-rs/src/config.rs` uses
  `std::env::var("DEPLOYD_AUDIENCE").expect(...)` and
  `std::env::var("DEPLOYD_REQUIRED_SCOPE").expect(...)`; boot fails if unset.
- **Phase 2.1** — `product/apps/opc/src-tauri/tauri.conf.json` CSP lacks
  `unsafe-eval`; `assetProtocol.scope` narrowed to `$APPDATA/**`,
  `$RESOURCE/**`.
- **Phase 2.3** — hex-only `content_hash` and separator-rejecting
  filename guards live in
  `crates/factory-engine/src/artifact_store.rs` and
  `crates/orchestrator/src/artifact.rs`.
- **Phase 2.8** — `runAsNonRoot` + `allowPrivilegeEscalation: false` on
  both `platform/charts/statecraft/templates/deployment.yaml` and
  `platform/charts/deployd-api/templates/deployment.yaml`.
- **Phase 3.3/3.4** — `thiserror = "2"` in `crates/factory-contracts/Cargo.toml`;
  `axum = "0.8"` in `crates/orchestrator/Cargo.toml`.
- **Phase 3.5** — `specs/038-titor-tauri-command-wiring/spec.md` and
  `specs/040-blockoli-semantic-search-wiring/spec.md` both carry
  `superseded_by: "073-axiomregent-unification"`.
- **Phase 4** — the catalog lives in §Phase 4 of this spec. Reintegration
  of the 17 packages into the desktop shell is deliberately out of scope
  for 100 and is tracked as ambient backlog.
