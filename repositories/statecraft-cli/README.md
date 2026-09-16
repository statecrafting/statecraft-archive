# statecraft-cli

One binary, two faces. `statecraft` exposes the
[Statecraft](https://github.com/statecrafting/statecraft) control
plane's governance verbs as CLI subcommands for humans and as an MCP
server for agents, so a coding agent (Claude Code first) can request
approvals, check spec-code coupling, and trigger factory stages natively
under governance instead of shelling out around it.

Successor to OPC, the Open Agentic Platform's desktop cockpit; the
desktop app is retired, the governance verbs live on here.

Since 2026-09-09 this repository is also the monorepo for the family's
tooling, daemons and CLI packages (design doc 02): the three members
formerly developed as claude-observatory live under `members/` (the sensor,
the engine and the Claude driver, a bun project), and `statecraft <name>`
dispatches to them (spec 108) without an account. The design record is
under `docs/design/`.

## Status

Milestone M4 in the Statecraft ladder, implemented: the crate scaffold
(102), auth + API client (103), the governance verbs (104), the MCP
stdio server (105), the template upgrade verb (106), member dispatch
(108) and the governed harness (109). The thesis and decided constraints
(binary name, Rust, stdio MCP, Apache-2.0, no TUI) live in
`specs/101-cli-mcp-thesis/spec.md`. The members' specs are 000-043; the
corpus merge is spec 110.

## Install

Prebuilt binaries for macOS and Linux (spec 107):

```sh
curl -fsSL https://raw.githubusercontent.com/statecrafting/statecraft-cli/main/install.sh | sh
```

Windows: download the `.zip` from the
[Releases](https://github.com/statecrafting/statecraft-cli/releases)
page. Every release archive ships a `.sha256` sidecar, a CycloneDX
SBOM, and a SLSA build-provenance attestation; the installer verifies
the checksum and (best-effort) the attestation. From source:
`cargo install --git https://github.com/statecrafting/statecraft-cli`
(rustls only, no OpenSSL).

## Governance

Governed by [spec-spine](https://github.com/statecrafting/spec-spine)
(`cargo install spec-spine-cli`): `spec-spine compile | index | lint`,
coupling gate at PR time, derived shards under `.derived/` are
compiler-owned.

## License

Apache-2.0 (see [LICENSE](LICENSE)).
