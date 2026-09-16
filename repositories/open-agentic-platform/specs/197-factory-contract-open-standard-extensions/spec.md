---
id: "197-factory-contract-open-standard-extensions"
title: "Open-Standard Factory Contract Extensions (Build Spec 1.1.0)"
feature_branch: "feat/197-factory-contract-open-standard-extensions"
status: approved
implementation: complete # AC-1..AC-7 landed via PR #312 (squash 81566933, 2026-06-09) with Rust+YAML+tests, commands.seed typed, SCHEMA_VERSION consts, provisioning_model REQUIRED. AC-8 closed 2026-06-10: factory origin/main @ cc1139f verified directly — contract/schemas/build-spec.schema.yaml declares schema_version "1.1.0" with field definitions identical to standards/schemas/factory/build-spec.schema.yaml (provisioning_model required, enum [admin-only, open-authenticated]; implementation_status optional, enum [live, stub, deferred]). The POC leg collapsed into the factory leg: factory-poc was absorbed into factory main by the 2026-06-09 handoff (#1 three-layer shape), so one verified surface covers both. See §AC-8 verification note.
amended: "2026-06-10"
amendment_record: |
  self-amended (2026-06-10) — AC-8 verification recorded; cross-repo
  section updated for the POC absorption; the richer-command-set timing
  claim corrected (the adapter rename landed via spec 199 / PR #313
  WITHOUT the typed-command promotion, which remains future work).
kind: platform
domain: platform
created: "2026-06-08"
authors: ["open-agentic-platform"]
language: en
summary: >
  Evolve the factory Build Spec contract from 1.0.0 to 1.1.0 with two
  generalizable fields — a REQUIRED per-audience provisioning_model and an
  optional per-integration implementation_status — under a governing principle:
  the factory contract is an open, reusable standard, so only org-agnostic
  concepts may enter it. GoA-specific concepts (classification labels, the
  external service catalog) are explicitly kept OUT of the contract, in the
  adapter/org layer. Aligns the canonical schema in standards/schemas/factory/
  and the factory-contracts Rust types, fixes the manifest commands drift,
  and is mirrored by the owned factory source (factory) and its POC.
code_aliases: ["BUILD_SPEC_OPEN_STANDARD_EXT"]
extends:
  - spec: "074-factory-ingestion"
    nature: additive
    unit: { kind: crate, id: factory-contracts }
refines:
  - aspect: "open-standard-contract-fields"
    unit: { kind: file, path: standards/schemas/factory/build-spec.schema.yaml }
  - aspect: "open-standard-contract-fields"
    unit: { kind: file, path: standards/schemas/factory/stage-outputs/audiences.schema.json }
references:
  - role: consumer
    unit: { kind: crate, id: factory-engine }
  - role: context
    unit: { kind: crate, id: orchestrator }
  - role: historical
    unit: { kind: directory, path: factory }
---

# Feature Specification: Open-Standard Factory Contract Extensions (Build Spec 1.1.0)

**Feature Branch**: `197-factory-contract-open-standard-extensions`
**Created**: 2026-06-08
**Status**: Approved
**Input**: OAP is replacing its factory dependency. The upstream
`legacy-factory` fold-in is retired; the owned factory source
(`factory`, scaffolding `template`) is authored directly from
OAP's needs. That swap surfaced two questions about the Build Spec contract
established by [spec 074](../074-factory-ingestion/spec.md): (1) the owned
factory ships a *live* permission-provisioning capability the 1.0.0 contract
cannot express, and (2) before others can reuse this contract as an open
standard, we must decide which concepts belong in the contract versus the
adapter/org layer.

## Purpose and charter

Deliver a **small, finishable** additive extension to the Factory Build Spec
contract that:

- Establishes the **open-standard principle** governing what may enter the
  contract layer (FR-001).
- Adds two **generalizable** Build Spec fields under that principle: a
  **required** `provisioning_model` (per-audience) and an **optional**
  `implementation_status` (per-integration) (FR-002, FR-003).
- **Defers** one generalizable-but-inert field (`security.assurance_level`)
  until its consuming machinery exists (FR-004).
- **Rejects** two GoA-specific concepts from the contract, recording where they
  belong instead (FR-005).
- Bumps the contract from **1.0.0 → 1.1.0** with full backward compatibility,
  and keeps the canonical YAML schema (`standards/schemas/factory/`) and the
  `factory-contracts` Rust types in lockstep (FR-006).
- Fixes a pre-existing **manifest commands drift** as contract hygiene (FR-007).

Non-goals: renaming the adapter (`acme-vue-node` → `acme-vue-encore`), reducing
`adapter-scopes.json`, or any factory-engine runtime behaviour change beyond
honouring the new optional fields. Those are tracked separately.

## The governing principle (open standard)

> **The Factory Build Spec is an open, reusable contract. Only concepts that
> generalize across organisations and technology stacks may enter the contract
> layer. Org-specific or stack-specific concepts live in the adapter
> (`adapters/<name>/`) or the org overlay — never the contract.**

This principle is the acceptance test for every future field. It is *why* the
contract layer is tech-agnostic (constitution Principle, [spec 074](../074-factory-ingestion/spec.md))
extended from "tech-agnostic" to "org-agnostic": a Protected-B classification
label or a Government-of-Alberta service catalogue is exactly as out-of-place in
the shared contract as an Express middleware reference.

The corollary: a concept being *valuable* (even mandated for our own use) is not
sufficient. It must also *generalize*. GoA-mandatory concepts that do not
generalize are honoured in the adapter/org layer, where they remain fully
expressible without polluting the standard.

## Requirements

### FR-001 — Open-standard principle is normative

The principle above governs contract evolution. A new Build Spec / Adapter
Manifest field is admissible only if it generalizes across orgs and stacks.
Reviewers apply this test; the spec text is the citation.

### FR-002 — Per-audience `provisioning_model` (required)

`auth.audiences.<name>.provisioning_model` — **required** enum
`{ admin-only, open-authenticated }`. There is **no default**: a missing value
is a hard parse error, never a permissive fallback. This is a deliberate
secure-by-design choice for an access-control selector — every audience makes an
explicit, auditable decision, closing the A01 permissive-default risk that an
optional+defaulted field would carry (an admin-only-intended audience whose
field was omitted would otherwise silently auto-provision).

- `admin-only`: a user record must be pre-created by an administrator before
  access; an unknown authenticated principal is denied. Selects generation of
  admin user-CRUD endpoints and a user-management page **for that audience**.
- `open-authenticated`: any IdP-authenticated principal gains access; the user
  record is auto-created on first login. No user-management page is generated
  for that audience.

**Per-audience, not per-app**: a dual-variant project may legitimately set
`citizen: open-authenticated` and `staff: admin-only`. This generalizes the
GoA-observed `provisioningModel` (which was app-level) without coupling to GoA.
The permission catalogue itself (`roles[].permissions[]`) already exists in
1.0.0; this field adds the orthogonal *how-users-gain-access* axis.

### FR-003 — Per-integration `implementation_status`

`integrations[].implementation_status` — optional enum
`{ live, stub, deferred }`. Absent ⇒ unspecified (adapter decides).

- `live`: implemented and wired to a real backing service.
- `stub`: stubbed; the adapter convention is to surface a "service pending"
  indicator rather than fail.
- `deferred`: declared but intentionally not yet implemented.

GoA's `catalog-auto` status is **not** adopted — it presumes a service
catalogue, which is org infrastructure, not a contract concept (see FR-005).

### FR-004 — Defer `security.assurance_level`

A generic `security.assurance_level` selecting an OWASP ASVS tier
(`asvs-l1` | `asvs-l2` | `asvs-l3`) is generalizable and admissible in
principle, but is **deferred**: nothing consumes it yet. It is admitted only
together with the verification-contract wiring that toggles check sets by tier,
designed in a future spec. Adding an inert field now would violate the
"earn its place" discipline.

### FR-005 — Explicit rejections (recorded, not contract fields)

The following GoA concepts are **rejected from the contract** under FR-001, with
their correct home recorded:

- **Security classification labels** (Public / Protected A / B / C) — a
  jurisdiction-specific scheme. Home: adapter/org overlay, optionally mapped to
  a future generic `assurance_level` (FR-004). The *binding* "Protected B ⇒
  ASVS-L2" is org policy, not contract.
- **External service catalogue** (the ~31 GoA OpenAPI specs + capability
  taxonomy) — org infrastructure. Home: an org/adapter resource. The generic
  per-integration *status* (FR-003) is the only catalogue-adjacent concept that
  generalizes, and it is adopted without the catalogue.

### FR-006 — Version bump + dual-surface lockstep

- Build Spec `schema_version` 1.0.0 → 1.1.0 in `standards/schemas/factory/build-spec.schema.yaml`.
- `crates/factory-contracts/src/build_spec.rs`: `Audience.provisioning_model` is a
  **required** `ProvisioningModel` (no serde default); `Integration.implementation_status`
  is an optional `Option<…>` enum (serde `kebab-case`, `skip_serializing_if = "Option::is_none"`).
  Both enums serialize kebab-case.
- **Version note:** `implementation_status` is additive; `provisioning_model` is a
  *required* addition to the audience shape, which is technically a breaking change
  to that shape. Because no production 1.0.0 Build Spec exists (the contract is
  pre-adoption) and the field codifies a decision the pipeline already makes at
  Stage 2, this is not a compatibility break in practice; `schema_version`
  increments to 1.1.0 and lets future consumers gate. A strict-semver reading
  (required-field addition ⇒ 2.0.0) is deferred pending real external adoption.
- The owned factory source (`factory`) and its POC mirror this exact
  delta; this spec text is the canonical definition both consume. The stage-output
  `audiences.schema.json` lists `provisioning_model` in its `required` set.

### FR-007 — Manifest commands drift + version consts (hygiene)

`standards/schemas/factory/adapter-manifest.schema.yaml` declares a `seed`
command that the Rust `Commands` struct does not model — it currently falls into
the untyped `#[serde(flatten)] extra` map and is invisible to the engine. Add
`seed` as a typed optional field so an adapter that relies on it is honoured
(AC-7).

The reference adapter (`acme-vue-encore`) declares a richer command set
(`gen_client`, `generate_keys`, `migrate`, `graph_check`, `pre_verify`,
`post_verify`) that is **not yet** in OAP's canonical manifest schema —
explicitly out of this spec's scope. *(Amended 2026-06-10: the original
staging said the promotion "lands with the adapter-rename PR"; the rename
landed via spec 199 / PR #313 without it — the manifest is served verbatim
under the thin consumer and unknown commands ride `extra` harmlessly. The
typed promotion remains future work, owed when engine-side consumption of
those commands becomes load-bearing.)* This keeps the drift fix minimal
and accurate to what OAP's schema declares today.

Add named `SCHEMA_VERSION` consts for AdapterManifest / BuildSpec /
PipelineState (the version literal lives only in fixtures today), following the
existing `PROVENANCE_SCHEMA_VERSION` pattern. BuildSpec's const is `"1.1.0"`;
the other two remain `"1.0.0"` (untouched).

## Acceptance criteria

- **AC-1**: An audience with no `provisioning_model` is a **hard parse error**
  (required field, no default). `implementation_status` remains optional — an
  integration without it deserializes unchanged and round-trips byte-stable.
- **AC-2**: `auth.audiences.staff.provisioning_model: admin-only` parses; an
  invalid value is a hard parse error with a clear message.
- **AC-3**: `integrations[].implementation_status: stub` parses; `catalog-auto`
  is rejected as an unknown variant.
- **AC-4**: The Rust types (`build_spec.rs`) and the YAML reference schema carry
  the same 1.1.0 field set, maintained together in this PR. (The build-spec
  contract is not yet under the automated schema-parity walker — that walker
  ([spec 125](../125-schema-parity-walker-rebuild/spec.md)) currently mirrors only
  knowledge/provenance/stakeholder-doc; bringing build-spec under it is future work.)
- **AC-5**: `security.assurance_level` is **absent** from both surfaces (the
  defer is enforced, not merely intended).
- **AC-6**: No GoA-specific token (classification label, service-catalogue
  identifier) appears anywhere in `standards/schemas/factory/` or
  `crates/factory-contracts/src/`.
- **AC-7**: A manifest declaring `commands.seed` resolves it as a typed field,
  not via `extra`.
- **AC-8**: The POC and factory Build Spec schemas declare
  `schema_version: "1.1.0"` and carry the identical field definitions to this
  spec (cross-repo conformance; verified when those repos land).
  *(Verified 2026-06-10 against factory `origin/main` @ `cc1139f`:
  `schema_version: "1.1.0"`, `provisioning_model` required with the
  identical enum, `implementation_status` optional with the identical
  enum. The POC surface no longer exists separately — factory main
  absorbed it via the 2026-06-09 handoff — so the two legs collapsed into
  the one verified surface.)*

## Cross-repo coordination

This spec is the **single source of truth** for the 1.1.0 delta. Three surfaces
mirror it:

1. **OAP (here)** — `standards/schemas/factory/*` + `crates/factory-contracts/src/*`
   + tests. (This spec's implementation track.)
2. **factory-poc** — `contract/schemas/build-spec.schema.yaml` + the
   adapter authorization pattern + examples + docs. (A dedicated CC agent
   working in that repo, briefed from this spec.)
3. **factory** — inherits the POC shape during its refactor (deferred
   until the POC is final).

*(Resolved 2026-06-10: surface 3 happened — the 2026-06-09 Windows handoff
mirrored the finalized POC into factory main, after which the POC
ceased to exist as a separate checkout. Surfaces 2 and 3 are now the same
repo, verified conformant under AC-8.)*

The adapter authorization *enforcement* (zero-role denial, case-insensitive
email lookup, server-side nav construction) is adapter-layer content keyed off
`provisioning_model`; it is honoured in the `acme-vue-encore` adapter, not in
this contract.
