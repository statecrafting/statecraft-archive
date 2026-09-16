# Compile and Registry

The transition from human-authored Markdown to machine-consumable truth is handled by the `spec-spine compile` command.

## The Compilation Process

When you run `make registry` (or `spec-spine compile` directly), the compiler performs the following steps:

1. **Discovery**: It scans the `specs/` directory for all `spec.md` files.
2. **Parsing**: It extracts and validates the YAML frontmatter against the constitutional schema.
3. **Graph Resolution**: It resolves all relationship edges (`establishes`, `extends`, `supersedes`, etc.) to build the complete Spec Relationship Graph.
4. **Emission**: It outputs deterministic JSON files into the `.derived/spec-registry/` directory.

## Sharded Output

To minimize merge conflicts and make the registry easier to diff, the compiler emits a sharded output. Instead of one massive JSON file, it creates a separate JSON file for each spec under `.derived/spec-registry/by-spec/`.

```text
.derived/spec-registry/
├── build-meta.json
└── by-spec/
    ├── 000-bootstrap-spec-system.json
    ├── 127-spec-code-coupling-gate.json
    └── ...
```

## Build Metadata

The `build-meta.json` file contains non-deterministic, wall-clock metadata about the compilation run (e.g., timestamp, compiler version). Because it changes on every run, it is carefully managed to avoid unnecessary Git churn.

## Determinism

A core constitutional principle (Principle IV) is that the compiler must be deterministic. If the Markdown inputs have not changed, the resulting JSON shards will be byte-for-byte identical. This ensures that the derived machine truth is a reliable foundation for the Coupling Gate and other automated checks.
