# Codebase Index

The Codebase Index (Spec 101) provides complete traceability between the code and the specifications that govern it. It answers the question: "Which spec owns this crate or package?"

## Spec-to-Code Traceability

Every Rust crate and npm package in the OAP repository must declare its governing spec. This is done in the package manifest.

For Rust crates (`Cargo.toml`):
```toml
[package.metadata.oap]
spec = "127-spec-code-coupling-gate"
```

For npm packages (`package.json`):
```json
{
  "oap": {
    "spec": "119-project-as-unit-of-governance"
  }
}
```

*Note: Per-crate documentation lives in the owning spec, not in per-crate READMEs. Do not invent or expect per-crate READMEs; route narrative to the spec.*

## Rendering the Index

The `spec-spine index render` command scans the repository, reads these manifests, and cross-references them with the compiled Spec Registry. 

It outputs a Markdown file at `.derived/codebase-index/CODEBASE-INDEX.md`. This file contains a comprehensive table mapping every code unit to its spec, description, and lifecycle status.

## Platform Enrichment

OAP uses an overlay tool, `oap-code-index-enrich`, to add platform-specific metadata to the codebase index. This tool reads the generic index output by `spec-spine` and injects OAP-specific columns or annotations before writing the final Markdown file.
