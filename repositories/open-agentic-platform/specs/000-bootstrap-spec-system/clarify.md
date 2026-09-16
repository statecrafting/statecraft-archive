# Clarification handoff: 000-bootstrap-spec-system

**Date**: 2026-03-22  
**Spec**: [spec.md](./spec.md)

## Status

**Interactive clarification not run** for the initial draft. A **ratification pass** (2026-03-22) tightened dates, determinism (`registry.json` vs `build-meta.json`), frontmatter rules, registry field normalization, and **V-005** scope—see [spec.md § Clarifications](./spec.md#clarifications).

## When to use `/speckit.clarify` later

Use interactive clarification for **subsequent** features if:

- Registry JSON field additions have competing interpretations.
- Determinism rules conflict with a required editor or platform.
- Policy exclusions for **V-004** (YAML) need expansion.

## Next suggested command

Proceed to Feature **001** specification, or implement compiler tasks in [tasks.md](./tasks.md) when ready.
