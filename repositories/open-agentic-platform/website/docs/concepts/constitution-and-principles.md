# Constitution and Principles

The Open Agentic Platform is governed by a Constitution (Spec 000) that establishes the foundational rules for how truth is recorded, processed, and enforced within the repository.

All contributors, human and agent alike, must resolve conflicts according to a strict normative hierarchy, where the Constitution sits at the top.

## The Five Core Principles

The Constitution defines five immutable principles:

### I. Markdown-Only Authored Truth
All human-authored durable truth in the repository is expressed as Markdown (`.md`). Optional YAML may appear **only** as frontmatter inside a Markdown file. Standalone YAML files are strictly forbidden as an authoring channel for platform truth (Invariant V-004).

### II. Compiler-Owned JSON Machine Truth
Machine-consumable registries, indices, and normalized metadata live in JSON format, but this JSON is **produced only** by the designated spec compiler (`spec-spine`). Hand-editing JSON in compiler output paths (`.derived/`) is a workflow violation.

### III. Spec-First Development
Features must be specified before implementation. The code justifies the spec, never the reverse. Specs are the authoritative design record, not documentation written after the fact.

### IV. Determinism and Validation
The spec compiler must be deterministic for the same committed inputs. Validation rules are product requirements, not suggestions, and the compiler enforces them rigorously.

### V. Legacy Inputs Are Non-Normative
Repositories used for reverse engineering or inspiration are evidence only. They are not sources of truth. Provenance must be declared when legacy concepts inform a design.

## Constitutional Invariant Freeze

Certain aspects of the system are so fundamental that they cannot be changed through normal amendment processes. Spec 132 introduces the concept of a `constrains:` relationship to enforce invariant freezes.

For example, the Constitution declares an `unamendable` list of validation rules (like V-001 through V-010) that are hardcoded into the spec compiler. Attempting to amend these rules will result in a constraint violation, and the Coupling Gate will reject the change.
