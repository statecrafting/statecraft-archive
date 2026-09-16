---
id: "192-decomposition-embedding-cache"
slug: decomposition-embedding-cache
title: "Decomposition embedding cache — content-addressed cross-run reuse for stage-3 clustering"
status: approved
implementation: complete
owner: bart
created: "2026-05-31"
kind: capability
domain: opc
risk: low
depends_on:
  - "165-opc-decomposition-pipeline"  # opc-decomposition-pipeline (the stage-3 clustering this caches)
code_aliases:
  - "DECOMPOSITION_EMBEDDING_CACHE"
establishes:
  - unit: { kind: file, path: crates/opc-decomposition-pipeline/src/embedding_cache.rs }
extends:
  - spec: "165-opc-decomposition-pipeline"
    nature: additive
    unit: { kind: file, path: crates/opc-decomposition-pipeline/src/stages/clustering.rs }
references:
  - role: substrate
    unit: { kind: file, path: specs/165-opc-decomposition-pipeline/spec.md }
summary: >
  A content-addressed, on-disk embedding cache for the decomposition
  pipeline's semantic-clustering stage (spec 165 stage 3). When the
  `embeddings` feature is enabled, stage 3 embeds each source file's content
  via fastembed; embedding is the dominant cost. This spec caches each
  embedding under `<output_root>/.embedding-cache/<sha256>.json`, keyed by the
  file's content hash, so unchanged files are never re-embedded across runs —
  the cross-run analogue of spec 165's stage-output cache (FR-007). The cache
  is the lightweight realisation of spec 165 landing-1's deferred follow-up
  F-006; it does not require the axiomregent persistent index, which remains a
  further future option for cross-tool sharing.
---

# 192 — Decomposition embedding cache

## 1. Problem

Spec 165's stage-3 clustering has two paths: a directory-grouping default
(FR-010 degraded path) and, behind the `embeddings` feature, a fastembed
vector-similarity path. In the embeddings path, embedding each file is the
dominant cost. Spec 165's stage cache (FR-007) reuses whole stage outputs when
the *entire* tree is unchanged, but it cannot reuse work when *most* files are
unchanged and a few moved — every run re-embeds every file from scratch.

Spec 165 landing-1 recorded this as follow-up F-006 ("persistent embedding
cache for stage 3 … cross-run reuse") and noted that an axiomregent-backed
persistent index "can be introduced behind the same `Clustering` trait if
cross-run cache-reuse becomes load-bearing." This spec delivers the
lightweight, dependency-free realisation.

## 2. Decision

Add a content-addressed on-disk embedding cache, keyed by file *content* hash
(not path), so a file that moved or a tree that changed elsewhere still hits
the cache for unchanged content.

- Cache root: `<output_root>/.embedding-cache/` (sibling of the per-run
  directories under `<project>/.opc/decomposition/`).
- Entry: `<sha256-of-file-content>.json` holding the embedding vector.
- The stage-3 embeddings path consults the cache before calling `embed_batch`;
  on a miss it embeds and writes the entry. Hits skip the model entirely.

The cache layer is a plain Rust type independent of fastembed, so it is unit
tested without the model; the integration into the `embeddings`-feature path
is a thin read-through.

## 3. Functional Requirements

- **FR-001** The cache stores and retrieves an embedding vector by the
  SHA-256 of the embedded content. `get` returns `None` on a miss; `put`
  is idempotent.
- **FR-002** The cache persists across process runs at
  `<output_root>/.embedding-cache/`, so a second run reuses the first run's
  embeddings for unchanged content.
- **FR-003** A corrupt or unreadable cache entry is treated as a miss (the
  file is re-embedded), never a hard failure — the cache is an optimisation,
  not a source of truth.
- **FR-004** When the `embeddings` feature is enabled, stage 3 reads through
  the cache: unchanged content is not re-embedded.

## 4. Success Criteria

- **SC-001** Round-trip: `put(hash, vector)` then `get(hash)` returns the
  vector; `get` of an unknown hash returns `None`.
- **SC-002** Persistence: a fresh cache instance over the same directory
  reads an entry written by a prior instance (cross-run reuse).
- **SC-003** Corrupt entry: a malformed entry file yields a miss, not an
  error.

## 5. Scope

### In scope

- The content-addressed on-disk cache type and its tests.
- The read-through integration in stage 3's `embeddings`-feature path.

### Out of scope (deferred)

- **axiomregent-backed persistent index.** Cross-tool / cross-project
  embedding reuse via the spec-073 axiomregent index stays a future option
  behind the same clustering seam (spec 165 landing-1 substrate note).
- **Cache eviction / size bounds.** The MVP cache grows unbounded under
  `.opc/`; GC is a future enhancement (the directory is developer-scratch and
  regeneratable).

## 6. Cross-references

- **Spec 165** §2.1 stage 3, FR-007 (stage cache), FR-010 (embeddings
  fallback); landing-1 follow-up F-006.
- **`crates/xray`** `analysis::embeddings` — the `embed_batch` substrate the
  cache fronts.
