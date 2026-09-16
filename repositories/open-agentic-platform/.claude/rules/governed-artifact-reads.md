# Governed Artifact Reads

These rules apply to every orchestrated workflow in this project — commands under `.claude/commands/**`, agents under `.claude/agents/**`, and the init protocol in `AGENTS.md`. Interactive, exploratory tool use answering a user question is not bound by this file.

> Governed by spec **`103-init-protocol-governed-reads`**. Extends constitution Principle II (compiler-owned JSON machine truth) from authoring to reads.

## Principle

Compiled artifacts under `.derived/**` MUST be read by orchestrated workflows through their designated consumer binaries. Ad-hoc parsers over `.derived/**/*.json` in a workflow step are a workflow violation.

## Consumer Binaries

| Artifact | Consumer | Common subcommands |
|----------|----------|---------------------|
| `.derived/spec-registry/by-spec/*.json` (sharded registry) | `spec-spine registry` | `list`, `list --ids-only`, `list --json`, `show`, `status-report --json`, `relationships --json` |
| `.derived/spec-registry/registry-oap.json` | `oap-registry-enrich` | `enrich` (default), `compliance-report`; `by-authority <path>` for path authority (spec 217 FR-302) |
| `.derived/codebase-index/by-spec/*.json` + `by-package/*.json` (sharded index) | `spec-spine index` | `check` (staleness; `--slice <name>` for a config slice), `render` (generic L1+L2+Diagnostics), `orphans` (newline ids or `--json` array) |
| `.derived/codebase-index/CODEBASE-INDEX.md` | `oap-code-index-enrich render` (OAP overlay L1-5) | read directly as the governed human view |

If a consumer subcommand is missing for a legitimate workflow query, add the subcommand under the consumer's spec — do not work around it with `python`, `jq`, `awk`, `sed`, or similar.

## Bad pattern

```bash
# Reaches past the consumer layer, guesses the shape, breaks on drift.
python3 -c "import json,glob; print(len(glob.glob('.derived/codebase-index/by-package/*.json')))"
```

## Good pattern

```bash
# Governed read. Typed at the tool boundary. Fails loudly on schema drift.
spec-spine index check                                    # staleness gate
spec-spine index render                                   # refresh markdown view
cat .derived/codebase-index/CODEBASE-INDEX.md                # human-shaped summary
spec-spine registry status-report --json --nonzero-only   # typed lifecycle counts
```

## Exceptions

- A consumer binary IS allowed to parse its own artifact (`serde_json::from_reader`). That is what makes it the consumer.
- A human running `jq` at the shell to inspect an artifact interactively is not an orchestrated workflow. The rule binds repeatable protocol steps, not debugging.
- If the `spec-spine` CLI is absent, workflows MUST instruct the user to `cargo install spec-spine-cli --version 0.10.0 --locked` (or `make setup`); if an OAP overlay binary is unbuilt, `cargo build --release --manifest-path tools/<name>/Cargo.toml`. Do NOT silently fall back to ad-hoc parsing.

## Enforcement (MVP)

Enforcement is by review. A future spec may add an automated lint that rejects commands or agents which spawn `python`/`jq`/`awk`/`sed` against `.derived/**/*.json`.
