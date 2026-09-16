---
id: "161-knowledge-requirements-provenance-emission"
slug: knowledge-requirements-provenance-emission
title: "Knowledge → Requirements provenance: emission contract and Requirements-view rendering"
status: approved
implementation: complete
owner: bart
created: "2026-05-22"
amended: "2026-06-18"
amendment_record: |
  amended 2026-06-18 by spec 217 (engine-swap collapse): the W-161
  decomposition-origin lint code is OAP-domain and remains in the surviving OAP
  overlay spec-lint. The engine swap removed only the generic half of the lint
  surface; W-161's home and behaviour are unchanged. Recorded for completeness.
kind: governance
domain: substrate
risk: medium
depends_on:
  - "154-logical-unit-ownership-grammar"  # logical-unit ownership grammar (the unit kinds)
  - "156-references-edge-provenance-grammar"  # references-edge provenance grammar (the typed external pointer)
  - "120-factory-extraction-stage"  # factory extraction stage (the knowledge → ExtractionOutput substrate)
code_aliases: ["KNOWLEDGE_REQUIREMENTS_PROVENANCE", "PROVENANCE_EMISSION_RENDERING"]
extends:
  - spec: "006-conformance-lint-mvp"
    nature: additive
    unit: { kind: file, path: tools/shared/spec-types/src/lib.rs }
  - spec: "006-conformance-lint-mvp"
    nature: additive
    unit: { kind: file, path: tools/spec-spine/spec-lint/src/lib.rs }
  - spec: "006-conformance-lint-mvp"
    nature: additive
    unit: { kind: file, path: tools/spec-spine/spec-lint/src/main.rs }
  - spec: "006-conformance-lint-mvp"
    nature: additive
    unit: { kind: file, path: tools/spec-spine/spec-lint/tests/lint.rs }
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
references:
  - role: decomposition-source
    unit: { kind: file, path: docs/owasp/factory/AIDE-VELOCITY-OAP-INTENT.md }
  - role: grammar-source
    unit: { kind: file, path: specs/156-references-edge-provenance-grammar/spec.md }
  - role: knowledge-substrate
    unit: { kind: file, path: specs/120-factory-extraction-stage/spec.md }
  - role: target-renderer
    unit: { kind: file, path: specs/163-statecraft-requirements-view/spec.md }
summary: >
  Spec 156 established the `references:` edge sibling
  `provenance:` field with two typed kinds (`knowledge`,
  `code-fingerprint`). The grammar exists; the two
  consumers don't. This spec specifies (a) the *emission
  contract* the OPC decomposition pipeline (spec 165)
  must follow when it lands a draft spec derived from a
  statecraft knowledge item or an xray code fingerprint,
  and (b) the *rendering contract* the statecraft
  Requirements view (spec 163) must follow when it
  displays such a spec to a developer reviewing the
  lineage. The two contracts are paired: an emitted
  provenance entry that the renderer cannot resolve is a
  drift event; a renderer that can resolve an entry that
  was not emitted is impossible by construction.

  Spec 161 closes the loop that AIDE-VELOCITY leaves
  implicit. In AIDE, a SharePoint document produces a
  `requirements.md` and the link between them is
  operational convention. In OAP, the link is a typed
  relationship-graph edge with two evidentiary anchors
  — `statecraft://project/<uuid>/knowledge/<uuid>` or a
  content-addressed xray fingerprint — and both the
  authoring tool and the review surface honour the same
  typed shape.
---

# 161 — Knowledge → Requirements provenance: emission & rendering

## 1. Problem

Spec 156 added a typed `provenance:` sibling on `references:` entries
with two initial kinds:

- `kind: knowledge` — a statecraft knowledge object identified by a
  `statecraft://project/<uuid>/knowledge/<uuid>` URI.
- `kind: code-fingerprint` — a content-addressed xray fingerprint of
  the code state at a particular instant.

The grammar is approved and the codebase-indexer threads provenance
entries through `resolved_units` with empty `locations` by design (per
spec 156 §3). What spec 156 deliberately *does not* commit to is:

1. **Who emits a provenance entry, and when.** The intent doc §6.2
   names the OPC decomposition pipeline as the producer of draft
   specs from knowledge + xray data, and §3.4 names the resulting
   provenance edge as load-bearing for the statecraft Requirements
   view. Neither side has an emission contract yet.
2. **How a renderer treats provenance entries.** The intent doc
   §3.4 says *"The Requirements view renders this provenance as a
   clickable link back to the originating Knowledge item or xray
   fingerprint snapshot."* No spec specifies what the link must
   resolve to, what fallback applies when the source no longer
   exists, or how the renderer behaves when a single spec carries
   multiple provenance entries.

Without an emission contract, the OPC decomposition pipeline could
ship draft specs that *claim* to have been derived from a knowledge
item but cite no URI — and the typed edge would degrade silently
into prose-only attribution. Without a rendering contract, the
Requirements view could ignore the edge entirely, treat it as a
non-clickable tag, or expose the raw URI without resolving it. Both
failure modes recreate the AIDE-VELOCITY problem (SharePoint
document ↔ requirements.md link as operational convention) inside
a substrate that already paid the cost of a typed grammar.

## 2. Decision

Specify the producer and consumer contracts as a pair. Both contracts
are derived from spec 156's grammar; neither modifies the grammar.

### 2.1 Emission contract (producer: OPC decomposition pipeline)

When the OPC decomposition pipeline (spec 165) lands a draft spec
that was derived from one or more source artifacts, that draft spec
**MUST** carry a `references:` entry per derivation source, with the
sibling `provenance:` field populated:

```yaml
references:
  - role: decomposition-origin
    provenance:
      kind: knowledge
      source: "statecraft://project/<uuid>/knowledge/<uuid>"
      derived_at: "<ISO-8601>"
  - role: decomposition-origin
    provenance:
      kind: code-fingerprint
      source: "<content-hash>"
      derived_at: "<ISO-8601>"
```

The `role: decomposition-origin` is the canonical role for
pipeline-emitted entries; renderers can filter on it to find
"specs derived from external sources" without walking every
`references:` edge. Other roles (`role: precedent`,
`role: implementation-witness`, etc., per spec 157's pattern)
continue to mean what they mean today.

### 2.2 Rendering contract (consumer: statecraft Requirements view)

When the statecraft Requirements view (spec 163) renders a spec, any
`references:` entry whose `provenance.kind` is `knowledge` or
`code-fingerprint` **MUST** be rendered as a typed lineage badge
adjacent to the spec card, distinct from in-tree
`references:` entries (which carry a `unit:` rather than a
`provenance:`).

The badge is clickable:

- For `kind: knowledge`: the click resolves to the originating
  Knowledge item at
  `/app/project/<uuid>/knowledge/<uuid>`. If the knowledge object
  has been deleted or is no longer accessible, the badge renders
  with a "knowledge unavailable" tooltip but the spec's text
  continues to render normally — the spec is not invalidated by
  missing provenance (spec 156 §3.3: dangling provenance is benign).
- For `kind: code-fingerprint`: the click resolves to an xray
  fingerprint inspection view (target spec TBD; this spec accepts
  a `/app/project/<uuid>/xray/fingerprint/<hash>` placeholder
  contract and refines once the xray UI lands).

### 2.3 Round-trip property

The pairing of §2.1 and §2.2 gives a structural property a
consumer can check at CI time: every `role: decomposition-origin`
entry in any project's spec spine **MUST** carry a
`provenance:` (V-rule emission owned by spec-lint, follow-up). Any
spec carrying `role: decomposition-origin` with a `unit:` instead
of a `provenance:` is a spec-lint failure — the role is reserved.

## 3. Functional Requirements

- **FR-001** The OPC decomposition pipeline (spec 165) emits at
  least one `references:` entry with `role: decomposition-origin`
  and a populated `provenance:` field on every draft spec it
  produces.
- **FR-002** The emitted entry uses `provenance.kind: knowledge`
  with a `statecraft://project/<uuid>/knowledge/<uuid>` URI when
  the derivation source was a statecraft knowledge object, and
  `provenance.kind: code-fingerprint` with a content-hash when the
  derivation source was an xray fingerprint of project code.
- **FR-003** Where a draft spec was derived from multiple sources
  (e.g., one knowledge item plus one code fingerprint), the
  pipeline emits multiple `references:` entries, each with its
  own `provenance:`.
- **FR-004** The statecraft Requirements view (spec 163) renders
  each `role: decomposition-origin` entry as a typed badge on the
  spec card. The badge text identifies the kind
  (`knowledge` / `code-fingerprint`) and the badge link target is
  the statecraft route for the source item.
- **FR-005** When a knowledge source is no longer resolvable (the
  knowledge object was deleted, or statecraft cannot find it), the
  badge renders with a degraded-state tooltip; the spec card
  itself continues to render normally and the spec remains valid.
- **FR-006** A new spec-lint rule (issued as part of this spec's
  implementation, owned by spec 006's lint surface) reserves the
  `role: decomposition-origin` value for entries that carry a
  `provenance:` field. Any entry with this role and no
  `provenance:` is a lint error (severity: error, not warning —
  the role is reserved by spec 161).
- **FR-007** The `derived_at` field on `provenance:` is required
  for `role: decomposition-origin` entries. It records the
  ISO-8601 timestamp at which the decomposition pipeline read the
  source; downstream consumers use it to display "derived from
  Knowledge X at <timestamp>" in the lineage badge.

## 4. Success Criteria

- **SC-001** A spec authored by the OPC decomposition pipeline
  (spec 165) carries `references:` entries with `role:
  decomposition-origin` and populated `provenance:` for every
  source it was derived from, with zero entries missing the
  required fields.
- **SC-002** The statecraft Requirements view renders the lineage
  badge as described in §2.2 for any project containing such
  specs; badges are clickable and link to the source item.
- **SC-003** A spec authored by hand (no pipeline involvement) is
  not required to carry `role: decomposition-origin` entries — the
  emission contract applies to the pipeline, not to the human
  author. Spec-lint does not flag hand-authored specs for missing
  decomposition-origin entries.
- **SC-004** A spec carrying `role: decomposition-origin` with a
  `unit:` instead of `provenance:` is rejected by spec-lint at
  V-026-equivalent severity (error).

## 5. Scope

### In scope

- The emission contract for the OPC decomposition pipeline.
- The rendering contract for the statecraft Requirements view.
- The role reservation (`role: decomposition-origin`) and its
  associated spec-lint rule.
- The `derived_at` timestamp field requirement.

### Out of scope (deferred)

- **Additional provenance kinds.** Spec 156 named two
  (`knowledge`, `code-fingerprint`). Future kinds (e.g.,
  `business-document`, `external-spec`) are out of scope until a
  concrete consumer surfaces.
- **Bidirectional resolution.** Spec 161 covers the spec →
  source direction. The reverse (source → list of specs derived
  from it) is enabled by spec 156's *structural reverse lookup*
  property (`git grep` over `specs/`) and does not require
  additional grammar; surfacing it as a statecraft UI panel is a
  separate spec.
- **xray fingerprint UI.** The badge for
  `kind: code-fingerprint` links to a statecraft route that may
  not exist yet; spec 161 accepts the placeholder contract and
  refines once the xray UI lands.

## 6. Cross-references

- **Spec 156** — the grammar this spec consumes; not modified.
- **Spec 120** — factory extraction stage; produces the knowledge
  → ExtractionOutput substrate from which knowledge URIs derive.
- **Spec 154** — logical-unit grammar; the broader edge structure
  the `provenance:` sibling extends.
- **Spec 163** — statecraft Requirements view; the rendering
  surface this spec specifies for.
- **Spec 165** — OPC decomposition pipeline; the producer this
  spec specifies for.
- **INTENT doc** §3.4 — the rendering aspiration; §6.2 — the
  pipeline-emission aspiration; this spec gives both contracts
  shape.


## Amendments received

**Amendment 2026-05-24 (record: 178-opc-directory-rename).**
Spec 178 (opc-directory-rename, 2026-05-24): mechanical regeneration
of `crates/featuregraph/tests/golden/features_graph.json` reflecting
the `product/apps/desktop/*` → `product/apps/opc/*` path rename in
spec frontmatter. No semantic change to this spec's claims; fixture
content updated 1:1 with the rename per the atomicity contract
encoded by spec 177 (ci-orchestrator-pr-gate) — featuregraph-golden
is a required ci-gate check precisely so renames carry their fixture
refresh inside the rename PR.
