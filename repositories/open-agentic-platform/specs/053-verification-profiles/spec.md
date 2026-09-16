---
id: "053-verification-profiles"
title: "Verification Profiles"
feature_branch: "053-verification-profiles"
status: approved
implementation: complete
kind: platform
domain: opc
created: "2026-03-29"
authors:
  - "open-agentic-platform"
language: en
summary: >
  YAML-based verification configuration with named profiles (pr, release, etc.),
  each composing reusable verification skills. Each skill declares a determinism
  level, safety tier, and ordered steps with command, timeout, read-only flag,
  and network policy. Post-session security gates require all verifiers to pass
  before changes are marked delivered, ensuring automated quality enforcement
  at every delivery boundary.
code_aliases:
  - VERIFICATION_PROFILES
  - VERIFY_GATES
refines:
  - aspect: "verification-gates"
    unit: { kind: crate, id: orchestrator }
sources:
  - claudepal
  - asterisk-mcp-server
  - developer-cc-commands
---

# Feature Specification: Verification Profiles

## Purpose

Verification logic today is scattered across individual scripts, CI configurations, and ad-hoc pre-commit checks with no unified schema or composability model. Multiple consolidation sources — claudepal (post-session verification), asterisk-mcp-server (safety checks), developer-cc-commands (lint/test/build commands) — each define verification steps in incompatible formats with no shared vocabulary for determinism, safety classification, or network access policy.

This feature introduces a YAML-based verification profile system where named profiles (e.g., `pr`, `release`, `hotfix`) compose reusable skills into ordered verification pipelines. Each skill declares its properties (determinism, safety tier, steps) and post-session security gates enforce that all required verifiers pass before changes are marked as delivered.

## Scope

### In scope

- **Profile schema**: A YAML schema for defining named verification profiles, each containing an ordered list of skills to execute.
- **Skill schema**: A YAML schema for defining verification skills with determinism level, safety tier, and ordered steps.
- **Step properties**: Each step declares a command, timeout, read-only flag, and network policy (allow, deny, restricted).
- **Post-session security gates**: After an agent session completes, configured verifiers must pass before the session's changes are marked as delivered.
- **Profile selection**: Profiles are selected by context (e.g., `pr` for pull request workflows, `release` for release pipelines) or explicit invocation.
- **Skill composition**: Profiles compose skills by reference, enabling reuse across multiple profiles.
- **Execution engine**: A runner that executes profile skills in order, respects step constraints, and reports pass/fail per skill and per profile.

### Out of scope

- **Verification UI**: No graphical interface for managing profiles; configuration is YAML-only.
- **Custom verification runtimes**: Skills execute shell commands; custom runtime environments (containers, VMs) are not addressed here.
- **Verification result storage**: Long-term storage and trending of verification results is a follow-on concern.
- **Auto-remediation**: Automatic fixing of verification failures is separate from this feature.

## Requirements

### Functional

- **FR-001**: Verification profiles are defined in YAML files following a strict schema. Each profile has a name, optional description, and an ordered list of skill references.
- **FR-002**: Verification skills are defined in YAML with: `name`, `description`, `determinism` (`deterministic` | `mostly_deterministic` | `non_deterministic`), `safety_tier` (`safe` | `cautious` | `dangerous`), and an ordered list of `steps`.
- **FR-003**: Each step in a skill specifies: `command` (shell command to execute), `timeout` (maximum execution time in seconds), `read_only` (boolean, whether the step modifies state), and `network` (`allow` | `deny` | `restricted`).
- **FR-004**: Post-session security gates are configured per profile. When a gate is active, the orchestrator blocks delivery (merge, deploy, publish) until all skills in the profile report `"passed"`.
- **FR-005**: Profile selection supports both explicit invocation (`--verify=release`) and automatic context detection (e.g., detect PR context and apply the `pr` profile).
- **FR-006**: Skills are referenced by name in profiles and resolved from a skill library (local project `.verification/skills/` directory or platform defaults).
- **FR-007**: The execution engine runs skills in declared order, enforces timeouts, respects read-only and network constraints, and produces a structured result report.
- **FR-008**: If any skill in a gated profile fails, the gate blocks delivery and reports which skills failed and why.

### Non-functional

- **NF-001**: Profile and skill YAML files are validated against a JSON Schema at load time; malformed files produce clear error messages with line numbers.
- **NF-002**: Verification profile execution adds < 1 second overhead beyond the sum of individual step execution times.
- **NF-003**: The skill library supports at least 50 skills per project without performance degradation in lookup or composition.

## Architecture

### Profile YAML schema

```yaml
# .verification/profiles/pr.yaml
name: pr
description: "Verification profile for pull request workflows"
gate: true  # Block delivery until all skills pass
skills:
  - lint
  - type-check
  - unit-tests
  - security-scan
```

### Skill YAML schema

```yaml
# .verification/skills/lint.yaml
name: lint
description: "Run linting across all source files"
determinism: deterministic
safety_tier: safe
steps:
  - command: "npm run lint"
    timeout: 120
    read_only: true
    network: deny
  - command: "npm run lint:styles"
    timeout: 60
    read_only: true
    network: deny
```

```yaml
# .verification/skills/security-scan.yaml
name: security-scan
description: "Run dependency and code security scanning"
determinism: mostly_deterministic
safety_tier: cautious
steps:
  - command: "npm audit --audit-level=high"
    timeout: 180
    read_only: true
    network: allow
  - command: "npx secretlint '**/*'"
    timeout: 120
    read_only: true
    network: deny
```

### Execution flow

```
Agent session completes
  |
  v
Post-session gate check: profile configured?
  |
  YES ---> Load profile YAML
  |         |
  |         v
  |       Resolve skill references from skill library
  |         |
  |         v
  |       Execute skills in order:
  |         |
  |         +---> Skill 1: lint
  |         |       +---> Step 1: npm run lint (read_only, network: deny)
  |         |       +---> Step 2: npm run lint:styles (read_only, network: deny)
  |         |       +---> Result: PASSED
  |         |
  |         +---> Skill 2: type-check
  |         |       +---> Step 1: npx tsc --noEmit (read_only, network: deny)
  |         |       +---> Result: PASSED
  |         |
  |         +---> Skill 3: unit-tests
  |         |       +---> Step 1: npm test (read_only, network: deny)
  |         |       +---> Result: FAILED (3 tests failed)
  |         |
  |         v
  |       Gate result: BLOCKED (unit-tests failed)
  |         |
  |         v
  |       Report failure, prevent delivery
  |
  NO ---> Mark delivered (no gate configured)
```

### Directory structure

```
.verification/
  profiles/
    pr.yaml
    release.yaml
    hotfix.yaml
  skills/
    lint.yaml
    type-check.yaml
    unit-tests.yaml
    integration-tests.yaml
    security-scan.yaml
    license-check.yaml
```

## Implementation approach

1. **Phase 1 -- schema definition**: Define the JSON Schema for profile and skill YAML files. Implement schema validation with clear error reporting.
2. **Phase 2 -- skill library**: Implement skill resolution from the local `.verification/skills/` directory and bundled platform defaults.
3. **Phase 3 -- execution engine**: Build the runner that executes skills in order, enforces step constraints (timeout, read-only, network policy), and collects structured results.
4. **Phase 4 -- post-session gates**: Integrate gate checks into the orchestrator's delivery path so that configured profiles block delivery on failure.
5. **Phase 5 -- profile selection**: Implement context-based automatic profile selection (PR detection, release branch detection) and explicit `--verify` flag.
6. **Phase 6 -- bundled skills**: Ship a set of commonly useful default skills (lint, type-check, test, security-scan, license-check) that projects can use out of the box.

## Success criteria

- **SC-001**: A `pr` profile with lint, type-check, and unit-test skills executes all steps in order and produces a structured pass/fail report.
- **SC-002**: A failing skill in a gated profile blocks delivery and reports the specific failure.
- **SC-003**: Step timeout enforcement kills a long-running step and marks the skill as failed.
- **SC-004**: Skills with `network: deny` cannot make outbound network requests during execution.
- **SC-005**: Malformed profile or skill YAML produces a validation error with file path and line number.
- **SC-006**: The same skill can be referenced by multiple profiles without duplication.

## Dependencies

| Spec | Relationship |
|------|-------------|
| 036-safety-tier-governance | Safety tiers in skills align with the platform's safety tier model |
| 035-agent-governed-execution | Governed execution triggers post-session verification gates |
| 052-state-persistence | Verification results can be persisted as workflow state for auditability |

## Risk

- **R-001**: Network policy enforcement (`deny`, `restricted`) is difficult to guarantee at the shell level without OS-level sandboxing. Mitigation: use network namespace isolation where available (Linux); on other platforms, document as best-effort with advisory warnings.
- **R-002**: Non-deterministic skills (e.g., security scans pulling latest vulnerability databases) may produce flaky gate results. Mitigation: determinism level is declared per skill so operators can configure tolerance; `mostly_deterministic` skills can be set to warn rather than block.
- **R-003**: Large numbers of verification steps may slow delivery significantly. Mitigation: support parallel execution of independent skills in a future enhancement; for now, profiles execute sequentially with timeout enforcement.
