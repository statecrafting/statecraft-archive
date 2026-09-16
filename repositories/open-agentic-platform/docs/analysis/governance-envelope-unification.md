# Governance Envelope Unification — OQ-1..OQ-4 resolved, all parts conformed to ASI 2026

> **Status:** design record, 2026-06-09. Feeds amendments to
> [spec 198](../../specs/198-factory-governance-envelope/spec.md) (resolves its
> OQ-1..OQ-4) and [spec 199](../../specs/199-factory-thin-consumer-sync/spec.md)
> (absorbs findings F1/F2), plus authoring worklists for the two owned upstream
> repos (`factory`, `template`). The law of record is
> `docs/owasp-agentic-top-10-2026.md` (cited below as ASInn mN / principle N).
> Current-state evidence: `docs/analysis/factory-sync-current-state.md`
> and the 2026-06-09 cross-repo verification (findings F1–F5).
>
> **Operator decision absorbed:** factory and template are ours
> to change. Conformance work lands upstream where the fact lives — OAP never
> compensates for a missing standard (spec 199 P-1).

## The unifying construct: one conformance chain, four links

Every part of the system becomes a link in a single content-addressed,
signature-carrying chain. Each link is validated by the link above it and can
be revoked independently. This is the whole design; D-1..D-6 below are its
load-bearing details.

```
LAW        OWASP ASI 2026 (docs/owasp-agentic-top-10-2026.md)
             │  encoded as the OAP-owned, ASI-tagged envelope schema
             ▼  (standards/schemas/factory/governance-envelope.schema.yaml)
BRIEF      factory files its envelope:
             • process/governance-envelope.yaml            (the run)
             • adapters/<n>/manifest.yaml `governance:`    (the scaffold boundary)
             • per-agent frontmatter (process AND adapter agents)
             • pinned scaffold source → template    (the supply-chain edge)
             ▼
ADMISSION  OAP (statecraft) adjudicates fail-closed:
             ⊨ schema  ∧  ⊨ constituents (recompute-and-reconcile)
             composes process ⊕ sub-envelopes, SIGNS the admission record
             (court seal), derives adapter-scopes.json as a projection,
             registers revocation keys for every node of the admitted graph
             ▼
EXECUTION  OPC (keyless, untrusted) runs only under a signed RUN-GRANT
             (the intent capsule), renewed at stage boundaries;
             axiomregent PEP enforces the admitted behavioral manifest;
             emission binds grant-chain + hashes into the governance
             certificate (102/168), platform-sealed, independently verifiable
```

The same chain holds for a third-party factory: same schema, same admission,
same seal, same grants. That is the open standard's teeth (198 FR-001).

---

## D-1 — Where the envelope lives (resolves OQ-1; fixes F3, F4)

### D-1.1 Process envelope: `process/governance-envelope.yaml` (factory)

A dedicated file at the process-layer root. There is no existing process-level
manifest to extend (the layer is `stages/ + agents/ + skills/` only), and the
factory's contract layer already uses standalone YAML as its machine idiom
(`contract/schemas/*.yaml`, `manifest.yaml`) — OAP's markdown-only Principle I
governs the OAP repo's *authored truth*, not the factory's contract artifacts,
which enter OAP as schema-validated, content-addressed substrate bytes
(machine layer, same class as the adapter manifest).

Contents (predicate-shaped, P-2; every field ASI-tagged per FR-002):

- **Declared objective class + constraints** — the intent-capsule *template*
  the per-run capsule must instantiate (ASI01 m5). Includes the stable
  goal-identifier scheme (ASI01 m7).
- **Aggregate tier ceiling + mutation ceiling** for the process layer
  (`max_tier: tier1`, `max_mutation: scoped-write` — see D-6) (ASI02 m1).
- **HITL gate predicates** (ASI09; principle 5) — e.g. "∃ approval gate at
  Build-Spec freeze", "∃ checkpoint before any stage whose agents exceed
  read-only", `plain_language_summaries: required`,
  `preview_side_effects: forbidden`. Never stage topology.
- **Emitted-artifact manifest** — what a conformant run emits, by kind
  (ASI07/ASI04 m1; binds to spec 170 signed inter-stage manifests).
- **Constituent pointers** — the agent files whose frontmatter the envelope
  composes (never copies — P-4): `process/agents/*.md`.
- **Override-consumption predicate** — whether runs may consume unverified
  per-org `user_body` overrides (see D-2; ASI06 m9).

### D-1.2 Adapter sub-envelope: a `governance:` section **inside** `manifest.yaml`

Bump the adapter-manifest schema **1.0.0 → 1.1.0** (both homes:
`standards/schemas/factory/adapter-manifest.schema.yaml` canonical,
factory `contract/schemas/` working copy). The section is part of the
manifest rather than a sibling file because:

1. The manifest **is** the adapter's self-declaration; the sub-envelope is its
   governance identity. One file = one content hash = one substrate row = one
   revocation key (D-3).
2. FR-003's reconcile compares declared scope against the adapter's *actual*
   surface — which is derived from the same file (`commands:`,
   `directory_conventions:`, `scaffold.emits:`). Single-file coherence removes
   a split-brain class for third-party authors.
3. The serve-time `schema_version` guard already polices this file.

```yaml
# manifest.yaml (schema 1.1.0) — new section
governance:                                    # ASI tags inline, per 198 FR-002
  max_tier: tier2                              # ASI02 m1, ASI03
  file_write_scope:                            # ASI02 m1, ASI05 m4
    - "apps/api/**"
    - "apps/web/**"
    - "apps/web-internal/**"
    - "packages/**"
    - "public/**"                              # dual-deploy copies
    - "internal/**"
  file_write_denied: [".env*", ".git/**", "node_modules/**"]
  allowed_commands_from: commands              # the manifest's own commands map
                                               # IS the allowlist (one home, P-4)
  scaffold_execution:                          # ASI05 — declared executable surface
    entry_points: [scaffold.entry_point, scaffold.entry_point_dual]
    setup_commands: scaffold.setup_commands
    isolation: sandbox-required                # specs 162/185/186 at run time
  agents_from: agents                          # constituents = the manifest's
                                               # agents map → frontmatter (D-1.3)
```

**`adapter-scopes.json` becomes a derived projection** of the admitted
sub-envelope (regenerated at admission), no longer hand-authored. One home per
fact (P-4): the manifest declares; OAP materializes the enforcement snapshot.
Spec 160's indexer-hashing of the snapshot is unchanged — it now hashes a
compiler-derived artifact, same as the rest of `.derived/`-style truth.

### D-1.3 Per-agent frontmatter — **adapter agents get it too** (closes F3)

The six `adapters/acme-vue-encore/agents/*.md` files gain the same frontmatter
grammar the process agents already carry (this is the factory authoring
precondition for admissibility — today FR-003 has nothing to read for exactly
the agents that hold `file_write`):

```yaml
---
id: api-scaffolder
safety_tier: tier2
mutation: scoped-write           # D-6 grammar
mutation_scope: ["apps/api/**"]  # ⊆ governance.file_write_scope (reconciled)
tools: [file_read, file_write, run_verify]   # ASI10 m5 behavioral manifest
---
```

Reconcile rules (198 FR-003, now fully specified): every agent's
`safety_tier` ≤ the owning envelope's `max_tier`; every `mutation_scope` ⊆ the
sub-envelope's `file_write_scope`; every agent in the manifest's `agents:` map
has frontmatter (a missing field fails closed). The de-facto tier table in
`docs/oap-integration.md` (process = tier1 read-only, scaffolders = tier2
file_write) is thereby promoted from prose to machine-checked truth.

---

## D-2 — `user_body` write-validation depth (resolves OQ-2; ASI06)

The law requires "rules + AI" scanning on memory writes (ASI06 m2) — but
cross-cutting principle 4 forbids trusting model output as an enforcement
basis. Resolution: **a model may detect, only rules may block.** Three tiers,
deterministic core:

**Tier A — deterministic, synchronous, blocking (the gate).** On every
`user_body` write to the substrate:
- Shape/size validation — an override stays its declared `kind`; ceilings.
- CDR-class carrier stripping (ASI01 m6): zero-width/bidi Unicode, HTML
  comments, oversized encoded blobs, data-URIs, ANSI escapes — disarm or
  refuse.
- Secrets scan (CONST-002 class) — credentials never enter the substrate.
- Provenance stamp (ASI06 m5): author identity (Rauthy subject), timestamp,
  content hash on every revision. Fail-closed on any rule hit.

**Tier B — structural trust segregation (ASI06 m3/m9).** Overrides are a
distinct trust class, permanently: served with provenance attached, never
blended indistinguishably with upstream-authored content in agent context
assembly. An override is `unverified` until a privileged human marks it
verified; the **process envelope declares the consumption predicate**
(`overrides: require_verified: true|false`) so the depth is an org's filed
policy, not an OAP hardcode (P-2). Every override consumed by a run is bound
into that run's governance certificate (102/168) — poisoning is traceable to
author, hash, and every run that consumed it, and revocable via D-3.

**Tier C — model-assisted detection, asynchronous, quarantine-only (ASI06 m2
"AI" half).** A scanner reviews new/changed overrides out-of-band; a flag
**quarantines** the override (D-3 machinery — blocks future serving pending
human review). It never approves and never sits in the synchronous path, so
enforcement stays deterministic and available.

Phasing: Tier A + provenance land with the admission gate; Tier B's
verified-flag + predicate with the envelope schema; Tier C as the follow-on
the 198 gap table already names — the ASI06 row graduates from
"partial — declared gap" to "designed, phased".

---

## D-3 — Kill-switch granularity (resolves OQ-3; ASI04 m8, ASI10 m4/m7)

**One mechanism, keyed on the nodes of the admitted composition graph.** Not a
choice between per-factory / per-adapter / per-agent — all of them, plus the
sharpest key the substrate already gives us:

| Revocation key | Effect (always fail-closed) | Law |
|---|---|---|
| **factory** (admission id) | nothing from this factory serves or binds | ASI04 m8 |
| **adapter** (sub-envelope) | adapter can't bind or scaffold; runs halt at handoff | ASI04 m8 |
| **agent** (behavioral-manifest entry) | PEP refuses the invocation — off-list = rogue (198 FR-006) | ASI10 m4 |
| **content hash** (any pinned artifact: prompt, manifest, template ref) | these exact bytes are refused wherever they appear | ASI04 m6/m7 |

Content-hash revocation is the supply-chain-correct primitive (a CVE names a
version; we name a hash). A fixed upstream commit yields new hashes and
re-enters through normal admission — no special un-revoke path for content.

Implementation: a `factory_revocations` table (org-scoped; global rows for
OAP-published advisories), `(scope_kind, key, mode, reason, actor, ts)`,
`mode ∈ {revoked, quarantined}`. Quarantine preserves the admission record for
forensics (ASI10 m4); **reintegration from quarantine requires fresh two-sided
validation + human approval** (ASI10 m7) — never an automatic flip back.

Checked at all three enforcement times: **serve** (statecraft read path, 199
FR-006), **bind** (project bind), **run** (grant issuance and every grant
renewal — D-4, which is what makes revocation propagate to in-flight OPC runs
within one stage boundary; ASI04 m6 continuous revalidation).

Template-encore is covered by the same key: the sub-envelope pins
`scaffold.source` ref + the resolved tree hash at admission; revoking that
hash blocks scaffolding org-wide instantly.

---

## D-4 — Signing keys and the keyless executor (resolves OQ-4; ASI10 m6)

**Statecraft is the signing authority — the court seal.** Signing belongs with
the judge: statecraft owns admission (syncPipeline/bind), so it owns the seal.
Keys live platform-side (Encore secrets; K8s Secret on Hetzner, KeyVault-backed
on AKS — HSM/KMS is a deployment-profile obligation declared in the schema
docs, not a contract field). Public keys are published JWKS-style at a
well-known statecraft endpoint with `kid` rotation. **OPC and every agent are
keyless, categorically** (ASI10 m6: "agents never hold signing keys —
the orchestrator mediates").

Three signature classes, one custody model:

1. **Admission seal.** At admission, statecraft signs the composed envelope
   record (process ⊕ sub-envelopes ⊕ constituent hashes ⊕ resolved scaffold
   source). The seal travels with the served bundle; the OPC engine verifies
   it against the published key before trusting any factory content
   (ASI04 m1).

2. **Run-grant — the signed intent capsule (198 FR-005).** A run cannot
   self-start governed:
   - The OPC engine submits the capsule content over the authenticated duplex
     channel: declared goal + stable goal id, constraints, admitted-envelope
     hash, Build-Spec hash (post-freeze), project, run id.
   - Statecraft validates the capsule **against the admitted envelope** (the
     PDP decision: is this run inside the brief?) and checks D-3 revocations,
     then returns a **short-lived, audience-bound run-grant**: a signed token
     binding `{org, project, run_id, capsule_hash, envelope_hash, exp, kid}`.
     This is ASI03 m5 (intent-bound tokens: subject, audience, purpose,
     session) + ASI02 m4/m6 (PEP issues short-lived credentials, JIT) +
     ASI10 m6 (per-run ephemeral credentials, one-time audience binding).
   - **Renewal at every stage boundary** ("signed per execution cycle",
     ASI01 m5). Renewal re-presents the current goal id and capsule hash:
     a goal shift → renewal refused → run pauses, deviation surfaced and
     recorded (ASI01 m4/m7); a revocation since issuance → refused (D-3
     propagation); expiry caps how long a wedged/compromised run can act
     (ASI08 m3). OPC already requires platform connectivity (spec 183 boot
     gate + duplex), so per-stage renewal adds no new availability coupling.

3. **Emission countersign.** The engine maintains the tamper-evident local
   hash chain it already produces (102/168 + 170); on sync-back, statecraft
   verifies the chain against the grant sequence it issued and countersigns
   the governance certificate. `verify-certificate` then proves **two**
   independent things: the artifact hash chain (works fully offline,
   producer-untrusted, unchanged) and the platform seal binding the run to its
   admission contract (198 FR-009/AC-4). A cert that never reconnected is
   verifiable-but-unsealed — visibly so, never silently equivalent.

Compromise analysis (why this is the right shape): a fully compromised OPC
holds — a revocable Rauthy session, grants valid only for declared intents
inside an admitted envelope, zero keys. It cannot mint authority, cannot
ratify its own work, and loses all standing one stage boundary after
revocation. That is "executor on conditions" made mechanical.

---

## D-5 — Identity seams unified (closes F1, F2; amends specs 140/141)

**Scaffold source resolution (F1).** The open-standard manifest keeps the
org-agnostic declaration it already has — `scaffold.source.{kind, remote,
default_ref}` — and the flat `scaffold_source_id` manifest field (spec 140
§2.2, injected today by the ingest mutation that 199 FR-007 deletes) is
**retired**. At admission, statecraft resolves `scaffold.source.remote`
against the org's `factory_upstreams` rows by normalized repo URL; the
resolved `source_id` + pinned ref/tree-hash are recorded **in the admission
record**, which is what `create.ts` and the scheduler read. Unresolvable
remote ⇒ inadmissible, with the same actionable error UX as today ("register
the upstream first"). Resolution-at-admission is enforcement, not
compensation (P-1): the org-scoped id is org configuration and never enters
the open contract (spec 197 principle).

**Template identity (F2).** Spec 141's `scaffoldSourceId ↔
template.json::templateName` alignment doctrine is superseded by
resolution-at-admission. `template.json::templateName` reverts to what it
truthfully is — the template's own name, **`"template"`** — consumed
only by template's module scripts (also fix the `'acme-vue-node'` zod
default in `scripts/lib/template-json.ts`). Spec 199 therefore declares
`supersedes: 140 (partial — §2.2 manifest-carried scaffold_source_id)` and
`supersedes: 141 (partial — §2.1 alignment doctrine)` in its relationship
graph, and its cross-repo section gains the template rename — "template
unaffected" was an understatement and is corrected.

## D-6 — Mutation grammar (closes F5)

Closed vocabulary, schema-enforced in agent frontmatter and reconciled by
FR-003:

```
mutation: read-only | scoped-write | write     # 'write' = unscoped; envelope
mutation_scope: [<glob|artifact-kind>, ...]    #   ceilings will normally
                                               #   forbid it (max_mutation)
optional: true|false                           # admitted-but-optional agent
```

`client-documentation-orchestrator` normalizes from the free-form
`read-only-except-requirements-client` to `mutation: scoped-write` +
`mutation_scope: ["requirements/client/**"]`. Optionality is allowlist
membership plus a flag — the run may skip the agent, but only listed agents
may ever run (ASI10: off-list = rogue). Non-numeric stage ids (`cd`) are
already legal: the envelope is open over stage keys (198 FR-002,
pipeline-state precedent), and the reconcile aggregates over *agents*, not
stage topology (P-2) — the 00–06 narrative in 198 gets a one-line correction
acknowledging optional stages.

---

## Per-repo worklists

**factory** (admissibility preconditions):
1. Author `process/governance-envelope.yaml` (D-1.1).
2. Manifest `governance:` section; schema working-copy bump to 1.1.0 (D-1.2).
3. Frontmatter for all six adapter agents (D-1.3); normalize
   `client-documentation-orchestrator` mutation (D-6).
4. Drop nothing else — `commands:`, `directory_conventions:`, `emits:` are
   already the reconcile evidence.

**template** (one honest rename + hygiene):
1. `template.json::templateName` → `"template"`; fix the zod default
   (D-5). No structural changes — its scaffold entry points are already
   declared in the adapter manifest, which D-1.2 elevates to governance facts.

**OAP**:
1. `governance-envelope.schema.yaml` + Rust twin + pinned SCHEMA_VERSION;
   adapter-manifest schema 1.1.0 (canonical home) — schema-parity green.
2. Admission gate in syncPipeline/bind: two-sided validation, scaffold-source
   resolution (D-5), composition, admission record.
3. `factory_revocations` + checks at serve/bind/grant (D-3);
   `adapter-scopes.json` derivation (D-1.2).
4. Signing service + JWKS endpoint; run-grant issue/renew over duplex;
   certificate countersign + `verify-certificate` seal check (D-4).
5. `user_body` Tier A gate + provenance; Tier B verified-flag + predicate;
   Tier C scanner as follow-on (D-2).

## Spec amendment map

- **Spec 198**: OQ-1→D-1 (new FR-012 envelope homes), OQ-2→D-2 (FR-013
  override-write contract; ASI06 row updated), OQ-3→D-3 (FR-010 refined:
  four keys, two modes, three check times), OQ-4→D-4 (FR-005 refined:
  run-grant + stage-boundary renewal; new FR-014 signing authority; AC-4/AC-5
  extended to seal verification). D-6 grammar into FR-003/FR-006. Fix stale
  frontmatter reference path (`docs/owasp/…` → `docs/…`).
- **Spec 199**: D-5 into FR-003/FR-009 (resolution-at-admission; retire
  injected `scaffold_source_id`); add partial supersessions of 140/141;
  cross-repo section gains the template rename; FR-007's
  `adapter-scopes.json` item updated to "derived projection per 198 D-1.2".
- **Sequencing** (replaces the implicit bootstrap deadlock): factory
  authors D-1 artifacts → 198 lands schema + admission gate (validate + record
  + revocations; seal in its own phase) → 199 cutover. The signing service
  (D-4) may land after the gate — admission is enforceable before it is
  sealable — but **before** 198 is declared complete.
