---
id: "000-bootstrap"
title: "Bootstrap spec system"
status: approved
created: "2026-07-17"
summary: >
  Foundational contract: authored truth lives only in markdown (+ YAML
  frontmatter); machine-consumable truth is compiler-emitted JSON only;
  every artifact is a deterministic function of (config, file contents);
  a typed authority graph governs who-owns-what. This repository is born
  governed: the spine exists before the first package arrives.
establishes:
  - "spec-spine.toml"
unamendable:
  - "markdown-truth-boundary"
  - "json-truth-boundary"
  - "determinism-requirement"
  - "typed-authority-graph"
  - "refusal-rule"
---

# 000: Bootstrap spec system

This is the spec that defines what a spec *is*. Ordinary specs live under
`specs/`. Each compilation unit links back here (or to a more specific
spec) via `[package.metadata.spec-spine].spec` in its manifest, a
`// Spec:` comment header, or a spec's ownership edge.

statecrafting runs its own spine rather than borrowing one. The packages
here are consumed by three repositories with three different licenses
(statecraft AGPL-3.0, enrahitu Apache-2.0, chancery Apache-2.0), so no
consumer's corpus can be the authority over them without making the other
consumers' governance a fiction. The packages are governed where they
live.

## 1. The authoring / derived boundary

Humans author markdown; the compiler owns the JSON. Never hand-edit a
derived artifact.

This repository has a live cautionary precedent. statecraft's
`Rename (#24)` renamed its derived shards by hand (`git mv` plus a
find-and-replace) instead of recompiling. Two failures followed: the
`spec-registry` shards for two specs kept their old filenames while their
bodies said otherwise, and the edited bodies carried `shardHash` values
that no longer matched their own contents, so the index reported STALE
until a later session recompiled. A hand-edit that looks like a rename is
still a hand-edit.

## 2. The typed authority graph

Specs declare typed edges (`establishes`, `extends`, `refines`,
`supersedes`, `amends`, `co_authority`, `constrains`, `references`) and
the units they own (file / section / symbol / directory / crate / module).
Authority is derived by walking the graph.

Ownership is exclusive: a path owned here is owned nowhere else. When a
package migrates in, the exporting repository's spec drops that path from
its `establishes` in the same change that adds it here. An edge is
transferred, never duplicated and never silently abandoned.

## 3. Pre-code

The spine lands before the packages. `standalone_rust_workspaces` and
`standalone_npm_packages` in `spec-spine.toml` both start empty; a package
appends itself to both as its own spec lands it. Spec 001 records what is
coming and in what order.

## 4. Transferred out

**2026-09-11, `.github/workflows/spec-spine.yml` to spec 008.** This spec
established the governance workflow along with the config, because when it
was written there was nothing else to hold it. Spec 008 installs the session
harness and makes `Makefile` the single definition of the gate; the workflow
that runs that gate belongs with it, so the path was retired and its
replacement, `.github/workflows/govern.yml`, is claimed there. This is the
section 2 rule applied to itself: the edge was dropped here in the same
change that added it there, transferred rather than duplicated or abandoned.

What stays here is the config. `spec-spine.toml` is the bootstrap's, because
it is the statement of what this corpus is, and spec 008 edits it the way any
spec edits a unit another spec owns.
