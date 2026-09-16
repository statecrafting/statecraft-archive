# The Gates

OAP relies on a series of strict CI gates to enforce governance and maintain codebase integrity. If a PR fails any of these gates, it cannot be merged.

## 1. The Coupling Gate (Spec 127)

The most critical gate in the platform. It enforces that any modification to a code path is accompanied by a modification to its governing specification. It uses the compiled codebase index and the Spec Relationship Graph to verify authority.

## 2. The Staleness Gate

Because OAP relies on derived machine truth (`.derived/`), it must ensure that these artifacts are never out of sync with the source Markdown or codebase manifests.

The staleness gate runs the compiler and indexer and checks if the output differs from what is committed. If there is a diff, it means a developer modified a spec or manifest without running `make registry`, and the build fails.

## 3. Schema Parity Walker (Spec 125)

OAP spans multiple languages, notably Rust (backend) and TypeScript (frontend/statecraft). The Schema Parity Walker ensures that the data contracts between these languages remain in lockstep. If a Rust struct changes without a corresponding update to the TypeScript interface, CI fails.

## 4. Supply Chain Policy (Spec 116)

OAP enforces strict supply chain security from Day 0. The `make ci-supply-chain` target runs:
- `cargo-deny` for Rust dependencies.
- `pnpm audit` for the frontend workspace.
- `npm audit` for the platform services.

Any high-severity vulnerability or unapproved license will block the build.

## 5. Config Hash (Spec 184)

The codebase indexer hashes critical configuration files, such as `.claude/settings.json` and `.mcp.json`. This ensures that quiet edits to agent settings or MCP server configurations trip the staleness gate, making them visible in the index diff and subjecting them to code review.
