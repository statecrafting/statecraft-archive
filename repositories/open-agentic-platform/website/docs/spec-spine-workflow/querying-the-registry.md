# Querying the Registry

To enforce the "Governed Reads" principle (Spec 103), all interactions with the compiled JSON registry must go through the `spec-spine registry` CLI.

## The Governed Read Surface

The CLI provides a typed, read-only interface to the registry. Here are the primary subcommands used in day-to-day development and by automated agents:

### 1. Status Report
Provides a lifecycle inventory across the entire spec corpus.
```bash
spec-spine registry status-report --json --nonzero-only
```
*Output: Counts of approved, draft, superseded, and retired specs.*

### 2. List Specs
Returns a list of all specs, optionally filtered by status or returning only IDs.
```bash
spec-spine registry list --ids-only
```

### 3. Show Spec Details
Returns the full compiled JSON for a specific spec.
```bash
spec-spine registry show 127-spec-code-coupling-gate
```

### 4. Graph Queries
The CLI includes commands specifically for querying the Spec Relationship Graph:
- `show-relationships`: Displays the incoming and outgoing edges for a spec.
- `show-supersession-chain`: Traces the history of a feature across superseded specs.
- `show-constraints-on`: Lists the specs that exert meta-authority (constraints) over a given path.

## Usage in Scripts and Agents

When writing CI scripts or configuring Claude Code agents (e.g., in the `/init` protocol defined in `AGENTS.md`), you must use these commands with the `--json` flag to obtain structured data. 

Never use `cat`, `jq`, or `python` to read the files in `.derived/spec-registry/by-spec/` directly.
