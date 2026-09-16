---
id: "169-tool-schema-strictness"
slug: tool-schema-strictness
title: "Per-tool JSON-Schema strictness enforcement — reject permissive ToolDef schemas"
status: approved
implementation: complete
owner: bart
created: "2026-05-22"
kind: governance
domain: opc
risk: medium
depends_on:
  - "036-safety-tier-governance"  # safety-tier-governance
  - "049-permission-system"  # permission-system
  - "067-tool-definition-registry"  # tool-definition-registry (the spec this spec refines)
  - "068-permission-runtime"  # permission-runtime
code_aliases: ["TOOL_SCHEMA_STRICTNESS", "PERMISSIVE_SCHEMA_REJECTION"]
establishes:
  - unit: { kind: file, path: crates/tool-registry/src/strictness.rs }
refines:
  - aspect: "schema-strictness-validation"
    unit: { kind: file, path: crates/tool-registry/src/lib.rs }
  - aspect: "schema-strictness-validation"
    unit: { kind: file, path: crates/tool-registry/src/registry.rs }
  - aspect: "schema-strictness-validation"
    unit: { kind: file, path: crates/tool-registry/src/async_registry.rs }
  - aspect: "schema-strictness-validation"
    unit: { kind: file, path: crates/tool-registry/src/types.rs }
  - aspect: "permissive-schema-bridge"
    unit: { kind: file, path: crates/axiomregent/src/registry_bridge.rs }
extends:
  - spec: "067-tool-definition-registry"
    nature: additive
    unit: { kind: file, path: crates/tool-registry/Cargo.toml }
  - spec: "067-tool-definition-registry"
    nature: additive
    unit: { kind: file, path: crates/tool-registry/src/tests.rs }
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
references:
  - role: decomposition-source
    unit: { kind: file, path: docs/owasp/factory/AIDE-VELOCITY-OAP-INTENT.md }
  - role: substrate-spec
    unit: { kind: file, path: specs/067-tool-definition-registry/spec.md }
  - role: doctrine-source
    unit: { kind: file, path: docs/owasp/owasp_top_10_agentic_applications_summary.md }
compliance:
  - framework: owasp-asi-2026
    controls: ["ASI02"]
summary: >
  OWASP ASI02 (Tool Misuse & Exploitation) prescribes
  *"Schema validation, strong typing, and transactional
  write guardrails"* as its core mitigation. OAP's
  `crates/tool-registry` (spec 067) defines the
  `ToolDef` trait with permission gates today; the
  registry accepts whatever schema the `ToolDef` author
  writes. A tool registering with
  `additionalProperties: true`, `type: any`, or an
  unconstrained `object` without `properties:` passes
  registration silently — and presents an
  attacker-friendly attack surface where the agent can
  smuggle arbitrary fields into the tool call.

  Spec 169 refines spec 067 with a compile-time
  validation pass: registrations whose JSON Schema is
  permissive are rejected at build time, not at first
  invocation. A `permissive: true` opt-out exists for
  the migration window — surfaced as a spec-lint
  warning so existing tools migrate incrementally — but
  the default-rejected stance is the structural
  posture.

  The rule applies symmetrically: at L1 (every OAP-
  registered tool) and at L2 (every tenant-side tool
  the substrate's born-with kernel produces — spec
  167 inherits the validation).
---

# 169 — Per-tool JSON-Schema strictness enforcement

## 1. Problem

`crates/tool-registry` (spec 067) defines `ToolDef` with a
JSON Schema for tool parameters. A representative weak
registration today:

```rust
ToolDef {
    name: "do_thing",
    parameters: json!({
        "type": "object",
        "additionalProperties": true,  // attacker may inject any field
    }),
    ...
}
```

Or:

```rust
parameters: json!({
    "type": "object",
    "properties": {
        "payload": { "type": "any" },  // accepts anything
    }
}),
```

Both register successfully today. Neither is detectably
distinguishable from a strict registration; both are
load-bearing risk for ASI02 (Tool Misuse & Exploitation).

The intent doc §7.2 names the gap:

> *"Forward gap on per-tool JSON-Schema strictness
> enforcement and default-read-only semantics."*

The convergence doc §2.D names the mitigation:

> *"Per-tool JSON-Schema parameter typing — non-permissive.
> ASI02's core mitigation is 'Schema validation, strong
> typing, and transactional write guardrails'. The
> `ToolDef` trait has the shape today; the runtime should
> reject any tool registration whose schema contains
> `any` or unconstrained `object`. This constraint must
> apply at L1 (every OAP-registered tool) and L2 (every
> tenant-side tool the substrate provides)."*

Without enforcement, the only signal of weakness is review
discipline. A new contributor adding a tool with a
permissive schema does so silently; the gap surfaces only
in adversarial-testing exercises.

## 2. Decision

Add a compile-time validation pass to `crates/tool-registry`
that rejects permissive schemas. Permissive means any of:

- `additionalProperties: true` on an `object` parameter.
- `type: "any"` anywhere in the schema.
- An `object` parameter without `properties:` declared.
- A `oneOf` / `anyOf` branch matching any of the above.
- A `$ref` to a schema definition that resolves to any
  of the above.

The validation runs at:

1. **Build time** (`cargo build` of any crate depending
   on `tool-registry`) — emits a compile error on the
   `register` call if the schema is permissive.
2. **Runtime registration** — for cases where the schema
   is computed (not literal), runtime validation rejects
   the registration with a typed error.

### 2.1 The migration opt-out

Existing tools whose schemas were written before this spec
landed may be permissive. To allow incremental migration,
a `permissive: true` opt-out exists:

```rust
ToolDef {
    name: "legacy_thing",
    parameters: json!({ ... }),
    permissive: true,  // accepted with warning
    ...
}
```

Setting `permissive: true` causes the registration to
succeed *with a spec-lint warning emitted against the
crate*. The warning is informational during the migration
window. After all in-tree tools have been migrated, a
follow-up spec promotes the opt-out to a compile error
(removing the field entirely from the public API).

### 2.2 L2 inheritance

Tenants born of the substrate (spec 167) carry the same
tool-registry validation. Tenant-side tool registrations
are validated by the same rules. The kernel includes the
validation logic so a tenant's CI catches permissive
schemas before tenant code reaches production.

### 2.3 Default-read-only semantics — adjacent posture

The convergence doc §2.D also names "default-read-only
tool semantics" as part of the ASI02 doctrine. Spec 169
does not by itself classify tools as read-only vs
state-changing — that classification is owned by spec 036
(safety-tier-governance). Spec 169 enforces the *schema*
strictness; spec 036 enforces the *capability* tiering.
They compose: a tool with a strict schema and a declared
safety tier is the structurally complete posture.

## 3. Functional Requirements

- **FR-001** `crates/tool-registry`'s `ToolDef`
  registration rejects schemas containing
  `additionalProperties: true`, `type: "any"`, or an
  `object` parameter without `properties:` declared.
- **FR-002** Rejection at build time is the default for
  literal-schema registrations; rejection at runtime
  registration time is the fallback for computed
  schemas.
- **FR-003** A `permissive: true` opt-out field exists
  on `ToolDef` during the migration window. Setting it
  causes the registration to succeed with a spec-lint
  warning identifying the crate and the permissive
  pattern.
- **FR-004** Validation is recursive: nested
  `properties:` values are validated; `oneOf` / `anyOf`
  branches are validated independently; `$ref`
  references resolve and are validated against the
  referenced schema.
- **FR-005** The validation logic is shared with the
  spec 167 kernel emission: tenants born of the
  substrate carry the same validator binary or
  toolchain reference.
- **FR-006** A tenant's CI (per spec 167's tenant-side
  gate wiring) invokes the validator against the
  tenant's own tool registrations; permissive schemas
  in tenant tools fail the tenant's CI.
- **FR-007** Migration target: a follow-up spec
  promotes the `permissive: true` opt-out to a build
  error, removing the field entirely. The follow-up
  spec lands only after all in-tree tools have migrated
  to strict schemas (a project-scoped milestone
  tracked as the SC-005 migration count).

## 4. Success Criteria

- **SC-001** Adding a new `ToolDef` with
  `additionalProperties: true` to an OAP crate fails
  `cargo build` with a diagnostic naming the violating
  registration.
- **SC-002** Existing `ToolDef`s with permissive schemas
  surface as spec-lint warnings; the warning identifies
  the crate, the tool name, and the specific permissive
  pattern.
- **SC-003** A computed-schema registration that
  resolves to a permissive shape fails at runtime
  registration with a typed error (not a panic, not a
  silent acceptance).
- **SC-004** A tenant born of the substrate (spec 167)
  inherits the validator; permissive tool schemas in
  the tenant's code fail the tenant's CI.
- **SC-005** The migration count of permissive `ToolDef`s
  in the in-tree corpus decreases monotonically — the
  contract this criterion records.

## 5. Scope

### In scope

- Build-time validation of literal schemas.
- Runtime validation of computed schemas.
- The `permissive: true` migration opt-out.
- Spec-lint warning emission for opted-out
  registrations.
- L2 inheritance via the born-with kernel.

### Out of scope (deferred)

- **Default-read-only enforcement.** Owned by spec 036
  (safety-tier-governance). Spec 169 enforces schema
  strictness; spec 036 enforces capability tiering.
- **Removal of the `permissive: true` field.** A
  follow-up spec lands when in-tree migration is
  complete.
- **Schema sophistication beyond the listed
  permissive patterns.** Future strictness rules
  (e.g., `format: <validated-format>` requirements
  for strings, range constraints on numbers) are
  separate refinements.
- **Tenant-side migration tooling.** A tenant inheriting
  the validator may have legacy permissive schemas;
  spec 169 provides the same `permissive: true`
  opt-out for tenant migration. Bespoke migration
  tooling beyond the opt-out is out of scope.

## 6. Compliance

Spec 169 is the load-bearing OAP mitigation for the
schema arm of **ASI02 (Tool Misuse & Exploitation)**. Per
OWASP doctrine: *"Schema validation, strong typing, and
transactional write guardrails."* The other two arms —
strong typing (Rust crates already enforce) and
transactional write guardrails (per-tool capability
tiering, spec 036) — are co-mitigations.

## 7. Cross-references

- **INTENT doc** §7.2, §9.10.
- **Spec 067** — tool-definition-registry; spec 169
  refines.
- **Spec 036** — safety-tier-governance; co-mitigation
  for the capability tier of ASI02.
- **Spec 049** — permission-system; complementary
  runtime control.
- **Spec 068** — permission-runtime.
- **Spec 167** — born-with kernel; inherits the
  validator.
- **Convergence doc §2.D** — the doctrine framing.


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
