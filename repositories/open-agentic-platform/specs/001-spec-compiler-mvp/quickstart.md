# Quickstart: Spec compiler MVP

**Feature**: `001-spec-compiler-mvp`

## Prerequisite

Feature **000** defines output contracts: [`specs/000-bootstrap-spec-system/spec.md`](../000-bootstrap-spec-system/spec.md).

## Build (once implemented)

```bash
cd tools/spec-spine/spec-compiler
cargo build --release
# Binary typically: target/release/spec-compiler
```

## Run (intended interface)

```bash
# From repository root (after implementation)
./tools/spec-spine/spec-compiler/target/release/spec-compiler compile
```

Outputs:

- `.derived/spec-registry/registry.json`
- `.derived/spec-registry/build-meta.json`

Validate with the same `ajv` commands as Feature 000 [`quickstart.md`](../000-bootstrap-spec-system/quickstart.md).

## Schemas

See [`contracts/README.md`](./contracts/README.md).
