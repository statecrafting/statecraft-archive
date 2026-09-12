# statecraft
 
The governed agentic delivery control plane for repositories customers
already have: intent becomes a governed spec, an agent produces a
candidate, acceptance is evidence, and publication happens at an exact
revision, with the customer's code in the customer's GitHub org the
entire time.

Governed delivery works locally, without a hosted account, through
[statecraft-cli](https://github.com/statecrafting/statecraft-cli).
statecraft is the hosted team layer on top of it: team approvals,
evidence retention and policy, served from a
[Rahi](https://github.com/statecrafting/rahi) cell. There is no initial
stamping and no managed hosting of customer applications. That is the
thesis the owner adopted on 2026-09-12 (spec 014 §4, which amends spec
001).

The architecture keeps its two-plane model (spec 001 §3.1): the platform
is one governed application, and a customer's application is another,
independent one, which the initial offer does not host.

The control plane running today is the first production EnRaHiTu app, as
built: one container, embedded [rauthy](https://github.com/sebadob/rauthy)
as the platform IdP (operator surfaces gated on the custom
`statecraft_operator` role), [hiqlite](https://github.com/sebadob/hiqlite)
in-process, and CoreLedger on Postgres for durable state. It keeps
running while its successor is proven: a Rahi pilot cell first (spec 017
Part A), and a migration of the live plane only after a rehearsal and a
recorded cutover decision (Part B).

## Status

Born governed. The spec spine is the authoritative design record; the
services of specs 002 through 008 have landed, and the deploy and
cluster specs (009/010) are in progress:

- `specs/000-bootstrap/` defines the spec system itself.
- `specs/001-statecraft-thesis/` is the enrahitu-era thesis and the
  consolidation record (what moved here from the Open Agentic Platform
  research era), rewritten ground-up 2026-07-19. It stays the record of
  what was built.
- `specs/014-rahi-realignment/` is the successor thesis, adopted
  2026-09-12. Its §4 amends 001's loop, identity, governed cell, service
  map and milestone ladder; two planes, tenancy and licensing stand.
- The successor's work: the hosted work contract (015) is approved as a
  schema slice, whose schemas, fixtures and pure evaluator live in
  statecraft-cli's Apache-2.0 workspace. The hosted work service (018),
  permits and the evidence chain (016) and the Rahi cell migration (017)
  are drafts.

Services live under their own numbered specs: `tenants/` (GitHub App
installations), `governance/` (attestation ledger + action gate + trust
window), `frontend/` (governance UI, Vite + React Router v7) and
`frontend-admin/` (the operator dashboard). `factory/` (stamping,
consuming enrahitu's `template.toml` contract and nothing else) and
`fleet/` (deployd's orchestration core as an in-process napi addon) keep
running as built, without expansion; they are not part of the offer, and
their retirement is deferred until the migration's inventory and
rollback are proven.

## Chassis

The running control plane is stamped from the
[enrahitu template](https://github.com/statecrafting/enrahitu) as its
first production consumer. The app shell (spec 002) imports the slimmed
two-directory chassis (`backend/` + `frontend/`) at enrahitu commit
`83a4551` (2026-07-15); the Encore toolchain and the hiqlite addon arrive
as pinned `@enrahitu/*` npm packages (`0.1.0`), not vendored source. The
imported chassis is Apache-2.0 entering this AGPL-3.0 repo, the sanctioned
direction. There is no born-with provenance cert here: it was to be
minted by the factory (spec 005) when stamping, and stamping is not part
of the offer.

The successor chassis is Rahi, also Apache-2.0: the pilot cell and, after
a recorded cutover decision, the migrated plane (spec 017). New hosted
services are built in that cell, never as an interim engine in
`backend/`.

## The product family

| Repo | License | Role |
|---|---|---|
| [statecraft-cli](https://github.com/statecrafting/statecraft-cli) | Apache-2.0 | Local governed delivery without an account, the CLI + MCP server, and the home of the shared evidence schemas and verifier |
| statecraft (this repo) | AGPL-3.0 | The control plane: tenants, governance, the hosted team layer and its UIs; the factory and fleet kept running without expansion |
| [rahi](https://github.com/statecrafting/rahi) | Apache-2.0 | The successor chassis: the Rust cell the hosted layer runs on (no release yet) |
| [enrahitu](https://github.com/statecrafting/enrahitu) | Apache-2.0 | The template chassis the running control plane is built on: Encore.ts + rauthy + hiqlite + Turso, single container |
| [statecraft.ing](https://github.com/statecrafting/statecraft.ing) | n/a | Website and docs |

## Governance

Governed by [spec-spine](https://github.com/statecrafting/spec-spine)
(`cargo install spec-spine-cli`):

```bash
spec-spine compile   # specs -> .derived/spec-registry/by-spec/
spec-spine index     # code linkage -> .derived/codebase-index/
spec-spine lint      # corpus conformance
spec-spine couple --base origin/main --head HEAD   # the PR coupling gate
```

Read `.derived/**` only through `spec-spine` subcommands; the shards are
compiler-owned.

## License

AGPL-3.0 (see [LICENSE](LICENSE)): hosting a modified control plane
commercially requires publishing the modifications, while self-hosting
stays free. The permissive family members (the CLI, Rahi, the template)
are Apache-2.0 in their own repos, and statecraft contributes no AGPL
code to them; customers' applications belong to their owners.
