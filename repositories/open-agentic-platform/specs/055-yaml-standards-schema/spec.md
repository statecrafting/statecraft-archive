---
id: "055-yaml-standards-schema"
title: "YAML Standards Schema"
feature_branch: "055-yaml-standards-schema"
status: approved
implementation: complete
kind: platform
domain: opc
created: "2026-03-29"
authors:
  - "open-agentic-platform"
language: en
risk: low
depends_on:
  - "054-agent-frontmatter-schema"
  - "053-verification-profiles"
  - "035-agent-governed-execution"
summary: >
  Machine-readable coding standards defined in YAML with structured fields: id,
  category, priority, rules (ALWAYS/NEVER/USE/PREFER/AVOID), anti-patterns,
  examples, context, and tags. A three-tier override system (official, community,
  project-local) layers standards from broad to specific. A standards contributor
  pipeline auto-generates candidate standards from execution findings, enabling
  continuous improvement of the standards library.
code_aliases:
  - YAML_STANDARDS
  - CODING_STANDARDS_SCHEMA
establishes:
  - unit: { kind: crate, id: standards-loader }
  - unit: { kind: file, path: product/packages/yaml-standards-schema/schemas/coding-standard.schema.json }
sources:
  - equilateral-agents
---

# Feature Specification: YAML Standards Schema

## Purpose

Coding standards today exist as prose in wikis, scattered README files, and tribal knowledge embedded in code review comments. They are not machine-readable, not composable, and not enforceable by automated tooling. The equilateral-agents consolidation source demonstrates the value of structured standards (style rules, naming conventions, architectural patterns) but uses an ad-hoc format that cannot be validated, overridden per project, or generated from observed patterns.

This feature introduces a YAML schema for machine-readable coding standards with structured rule types, a three-tier override system for layering official, community, and project-local standards, and an auto-generation pipeline that produces candidate standards from execution findings.

## Scope

### In scope

- **Standards YAML schema**: A schema for defining individual standards with `id`, `category`, `priority`, `rules` (typed as ALWAYS/NEVER/USE/PREFER/AVOID), `anti_patterns`, `examples`, `context`, and `tags`.
- **Three-tier override system**: Official standards (shipped with the platform) can be extended or overridden by community standards (shared across teams) which can be further overridden by project-local standards.
- **Standards resolution**: A resolver that merges standards across all three tiers, with later tiers overriding earlier ones for the same standard id.
- **Standards contributor pipeline**: An automated pipeline that analyzes execution findings (lint results, code review feedback, test failures) and generates candidate standards for human review.
- **Validation**: JSON Schema for the standards YAML format, enabling editor support and CI validation.

### Out of scope

- **Standards enforcement engine**: How standards are enforced during code generation or review is a separate concern; this feature defines the schema and resolution.
- **Standards marketplace**: Publishing and discovering community standards in a registry is a follow-on feature.
- **IDE plugins**: Editor integrations for displaying active standards inline are not covered here.
- **Natural language generation**: Generating prose documentation from YAML standards is a follow-on concern.

## Requirements

### Functional

- **FR-001**: Each standard is defined in a YAML file with required fields: `id` (unique string, kebab-case), `category` (string, e.g., `naming`, `error-handling`, `testing`, `architecture`), `priority` (`critical` | `high` | `medium` | `low`), and at least one `rule`.
- **FR-002**: Rules are typed with a verb: `ALWAYS` (mandatory), `NEVER` (prohibited), `USE` (recommended tool/pattern), `PREFER` (preferred over alternatives), `AVOID` (discouraged). Each rule has a `verb`, `subject`, and `rationale`.
- **FR-003**: Standards optionally include `anti_patterns` (array of code patterns that violate the standard, each with a `pattern` and `correction`), `examples` (array of good/bad code examples with `good`, `bad`, and `explanation` fields), `context` (string describing when the standard applies), and `tags` (array of strings for filtering).
- **FR-004**: The three-tier override system resolves standards in order: official (platform defaults) -> community (team or organization level) -> project-local (repository-specific). For a given standard `id`, the most local tier wins. Tiers can also extend a standard from a broader tier rather than fully replacing it.
- **FR-005**: Standards files are located in well-known directories: `standards/official/` (bundled), `standards/community/` (from shared config), `standards/local/` (in project root).
- **FR-006**: The standards contributor pipeline accepts execution findings (structured data from linters, test runners, code review tools) and generates candidate standard YAML files with `id`, `category`, draft `rules`, and `anti_patterns` derived from the findings.
- **FR-007**: Generated candidate standards are marked with `status: candidate` and require human review before promotion to `status: active`.
- **FR-008**: A resolver function accepts a category or tag filter and returns the merged set of active standards applicable to the current context, with override resolution applied.

### Non-functional

- **NF-001**: Standards resolution for a project with 200 standards across all three tiers completes in < 100ms.
- **NF-002**: The YAML schema is validated by a JSON Schema file; malformed standards produce clear errors with file path, line number, and field path.
- **NF-003**: The schema is extensible: unknown fields in standards YAML are preserved for forward compatibility.

## Architecture

### Standard YAML schema

```yaml
# standards/official/error-handling-001.yaml
id: error-handling-001
category: error-handling
priority: high
context: >
  Applies to all TypeScript and JavaScript source files that perform
  async operations or interact with external services.
tags:
  - typescript
  - javascript
  - async
  - error-handling

rules:
  - verb: ALWAYS
    subject: "wrap async operations in try/catch blocks"
    rationale: >
      Unhandled promise rejections crash the process in Node.js and produce
      opaque errors in browsers. Explicit error handling ensures graceful
      degradation and actionable error messages.

  - verb: NEVER
    subject: "use empty catch blocks"
    rationale: >
      Swallowing errors silently makes debugging impossible. At minimum,
      log the error or re-throw with additional context.

  - verb: PREFER
    subject: "typed error classes over generic Error"
    rationale: >
      Typed errors enable callers to handle specific failure modes without
      string matching on error messages.

anti_patterns:
  - pattern: "catch (e) {}"
    correction: "catch (e) { logger.error('Operation failed', { error: e }); }"
  - pattern: "catch (e) { return null; }"
    correction: "catch (e) { throw new SpecificError('Context', { cause: e }); }"

examples:
  - bad: |
      async function fetchUser(id) {
        const res = await fetch(`/api/users/${id}`);
        return res.json();
      }
    good: |
      async function fetchUser(id: string): Promise<User> {
        try {
          const res = await fetch(`/api/users/${id}`);
          if (!res.ok) throw new ApiError(`Fetch user failed: ${res.status}`);
          return await res.json();
        } catch (error) {
          throw new UserFetchError(id, { cause: error });
        }
      }
    explanation: >
      The good example wraps the fetch in try/catch, checks response status,
      and throws a typed error with context rather than letting failures
      propagate as opaque rejections.
```

### Three-tier override resolution

```
standards/official/         (Tier 1 - platform defaults)
  error-handling-001.yaml
  naming-001.yaml
  testing-001.yaml

standards/community/        (Tier 2 - team/org shared)
  naming-001.yaml           <-- overrides official naming-001
  architecture-001.yaml     <-- new standard, not in official

standards/local/            (Tier 3 - project-specific)
  testing-001.yaml          <-- overrides both official and community
  project-conventions.yaml  <-- project-only standard

Resolution for "testing-001":
  official/testing-001.yaml -> community (none) -> local/testing-001.yaml
  Result: local version wins
```

### Standards contributor pipeline

```
Execution findings (lint errors, review comments, test failures)
  |
  v
Finding aggregator: group by category, count frequency
  |
  v
Candidate generator: extract patterns, draft rules and anti-patterns
  |
  v
Candidate YAML file (status: candidate)
  |
  v
Human review: approve, edit, or reject
  |
  v
Promoted standard (status: active) added to appropriate tier
```

### Directory structure

```
standards/
  official/
    error-handling-001.yaml
    naming-001.yaml
    testing-001.yaml
    ...
  community/
    (loaded from shared config path)
  local/
    (in project root)
  candidates/
    (auto-generated, pending review)

packages/yaml-standards-schema/schemas/
  coding-standard.schema.json   ← canonical schema (npm-package consumer)
```

## Implementation approach

1. **Phase 1 -- schema definition**: Define the YAML schema for standards and produce the JSON Schema file for validation. Implement schema validation with clear error reporting.
2. **Phase 2 -- parser and resolver**: Implement the standards parser and three-tier resolution logic. Given a project context, produce the merged set of active standards with correct override precedence.
3. **Phase 3 -- official standards library**: Author an initial set of official standards covering common categories (error handling, naming, testing, security, architecture).
4. **Phase 4 -- contributor pipeline**: Build the finding aggregator and candidate generator that produces draft standards from execution data (lint results, review feedback).
5. **Phase 5 -- candidate review workflow**: Implement the review workflow for candidate standards: list candidates, approve/edit/reject, promote to active.
6. **Phase 6 -- integration**: Wire the standards resolver into agent system prompts so that active standards inform code generation and review behavior.

## Success criteria

- **SC-001**: Standards YAML files pass JSON Schema validation and produce clear errors when malformed.
- **SC-002**: Three-tier resolution correctly applies overrides: a project-local standard with the same `id` as an official standard replaces the official version in the resolved set.
- **SC-003**: The resolver returns only `status: active` standards; `status: candidate` standards are excluded from the resolved set.
- **SC-004**: The contributor pipeline generates a syntactically valid candidate standard YAML from a set of lint findings.
- **SC-005**: All five rule verbs (ALWAYS, NEVER, USE, PREFER, AVOID) are supported and correctly represented in parsed output.
- **SC-006**: Resolution of 200 standards across three tiers completes in under 100ms.

## Dependencies

| Spec | Relationship |
|------|-------------|
| 054-agent-frontmatter-schema | Agents may reference applicable standards via tags in their frontmatter |
| 053-verification-profiles | Verification skills can check compliance with active standards |
| 035-agent-governed-execution | Standards inform governed execution constraints for code generation |

## Risk

- **R-001**: Overly prescriptive standards may conflict with legitimate project-specific patterns. Mitigation: the three-tier override system allows projects to override or disable any standard.
- **R-002**: Auto-generated candidate standards may be low quality or noisy. Mitigation: candidates require explicit human review and approval before becoming active; the pipeline prioritizes high-frequency findings.
- **R-003**: Large standards libraries may overwhelm agent context windows when injected into system prompts. Mitigation: standards are filtered by category and tags relevant to the current task; only applicable standards are injected.
