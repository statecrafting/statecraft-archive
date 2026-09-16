---
id: "100-bootstrap"
title: "Bootstrap spec system (statecraft-cli, before the merge)"
status: superseded
superseded_by: "000-bootstrap"
created: "2026-07-14"
# A record of authority held before the merged graph existed (spec 110):
# it claims no territory here, and its units passed to 110.
origin:
  retroactive: true
summary: >
  Foundational contract: authored truth lives only in markdown (+ YAML
  frontmatter); machine-consumable truth is compiler-emitted JSON only;
  every artifact is a deterministic function of (config, file contents);
  a typed authority graph governs who-owns-what. This repository is born
  governed: the spine exists before the first line of product code.
unamendable:
  - "markdown-truth-boundary"
  - "json-truth-boundary"
  - "determinism-requirement"
  - "typed-authority-graph"
  - "refusal-rule"
---

# 100: Bootstrap spec system

> Superseded on 2026-09-09 by `000-bootstrap`, the single bootstrap of the
> merged corpus (design doc 02 D28). This repository's original specs
> 000-009 renumbered into 100-109 in the same change (spec 110); the two
> units this spec established, `spec-spine.toml` and the governance
> workflow, are owned by spec 110.

This is the spec that defines what a spec *is*. Ordinary specs live under
`specs/`. Each compilation unit links back here (or to a more specific
spec) via `[package.metadata.spec-spine].spec` in its manifest, a
`// Spec:` comment header, or a spec's ownership edge.

## 1. The authoring / derived boundary

Humans author markdown; the compiler owns the JSON. Never hand-edit a
derived artifact.

## 2. The typed authority graph

Specs declare typed edges (`establishes`, `extends`, `refines`,
`supersedes`, `amends`, `co_authority`, `constrains`, `references`) and
the units they own (file / section / symbol / directory / crate / module).
Authority is derived by walking the graph.
