# Makefile Flows

The `Makefile` at the repository root is the primary entry point for all local development, validation, and CI tasks in the Open Agentic Platform.

## Daily Development Loop

For rapid iteration during local development, use the fast CI target:

```bash
make ci
```
This target (defined by Spec 135) runs a fast, parallel validation suite that takes about 5 minutes on a warm cache.

## Strict Parity Validation

Before merging a pull request, or when investigating parity drift, run the strict mirror target:

```bash
make ci-strict
```
This target mirrors every CI workflow gate exactly as it runs on GitHub Actions. It is comprehensive and takes approximately 90 minutes.

## PR Preparation

Before pushing a branch, ensure you run the PR prep target:

```bash
make pr-prep
```
This runs the codebase indexer and the fast Spec/Code Coupling check against `origin/main`. 

*Gotcha: Always re-run `make pr-prep` after the **final** commit of a multi-commit PR. If you run it between commits, it only validates the partial diff, and the CI coupling gate may fail on the full branch diff.*

## Development Services

To start local development servers:

- `make dev`: Starts the OPC desktop application.
- `make dev-platform`: Starts the background platform services (statecraft and deployd-api).
- `make dev-all`: Starts both desktop and platform services.
- `make stop`: Kills the background platform services.

## Registry Compilation

To manually rebuild the compiled JSON registry and the codebase index:

```bash
make registry
```
This runs `spec-compile`, `oap-registry-enrich`, `index`, `oap-code-index-enrich`, and `ci-schema-parity`.
