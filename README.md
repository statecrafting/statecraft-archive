# statecraft.ing

The website and docs for [Statecraft](https://github.com/statecrafting/statecraft),
the governed agentic delivery control plane, and its product family.

The site is live at [statecraft.ing](https://statecraft.ing): a fully static
React Router v7 app (framework mode, prerendered, no SSR at runtime) deployed
to GitHub Pages. It carries a landing page whose status ladder is rolled up
from the family's specs at build time, a products/architecture page, a docs
seed, a whitepaper reader with interactive architecture diagrams, a
get-started walkthrough, and a spec-registry viewer over build-time-baked
shards from the public repos. Nothing is fetched at runtime: no backend, no
analytics, no third-party scripts.

The site is itself one of `spec-spine`'s governed corpora. `specs/` is the
authoritative design record, `.derived/` holds the committed compiler output,
and the coupling gate refuses code that moves without its owning spec. See
`AGENTS.md` for the session protocol and `CLAUDE.md` for the orientation.

## The product family

Eleven public repositories under the
[statecrafting](https://github.com/statecrafting) org. The roster is owned by
`specs/003-product-family-registry/spec.md` and encoded once in
`app/lib/product-family.ts`; the licenses below are the SPDX ids in each
repo's own LICENSE file.

- [statecraft](https://github.com/statecrafting/statecraft): the control
  plane (AGPL-3.0)
- [enrahitu](https://github.com/statecrafting/enrahitu): the EnRaHiTu
  template chassis: Encore.ts + rauthy + hiqlite + Turso (Apache-2.0)
- [statecraft-cli](https://github.com/statecrafting/statecraft-cli): the
  `statecraft` binary, its MCP server, and the local delivery engine, sensors,
  drivers and browser UI it dispatches to (Apache-2.0)
- [spec-spine](https://github.com/statecrafting/spec-spine): the
  spec-governance toolchain everything above is governed by
- [tenant-emit](https://github.com/statecrafting/tenant-emit): the tenant
  certificate emitter, signing a governance certificate reconstructed from a
  finished run (Apache-2.0)
- [tenant-tail](https://github.com/statecrafting/tenant-tail): the tenant
  certificate verifier, re-checking a factory's run-side paperwork with no
  trust in the producer (Apache-2.0)
- [action-gate](https://github.com/statecrafting/action-gate): a pure,
  deterministic decision gate, evaluate(context, checks) returning Allow, Deny,
  or Degrade (Apache-2.0)
- [attest-ledger](https://github.com/statecrafting/attest-ledger): a
  tamper-evident record ledger, append-only, hash-linked, with an
  Ed25519-signable genesis anchor and an independent verifier (Apache-2.0)
- [canonical-keysort-json](https://github.com/statecrafting/canonical-keysort-json):
  deterministic canonical JSON, a lexicographic key sort at the serialization
  boundary so record hashes agree (Apache-2.0)
- [trust-window](https://github.com/statecrafting/trust-window): a
  rolling-window trust scorer, weighted samples mapping to a graduated privilege
  level (Apache-2.0)
- [statecrafting](https://github.com/statecrafting/statecrafting): the shared
  native packages, the `@statecrafting/*` napi addons and the Encore build
  toolchain (Apache-2.0 at the root; two addons are AGPL-3.0, and the three
  platform packages carrying the vendored Encore core are MPL-2.0)

## Build

```bash
make gate                 # the governed loop, read-only, in the required order
make typecheck build      # npm run typecheck, then npm run build
npm ci && npm run dev     # local dev (predev bakes the registry payload)
```
