# Data model — Spec-kind grammar (amendment 147)

This document formalizes the frontmatter field grammar introduced by
amendment 147. It extends `specs/000-bootstrap-spec-system/data-model.md`
without modifying it; the original data model remains authoritative
for fields it declares.

## `FeatureRecord` extensions

The following fields are added to `FeatureRecord` in registry.json
output. All are optional unless conditioned on `kind:`.

### `kind: string` (enum, optional)

Promoted from free-form string to closed enum.

Allowed values:
```
platform | platform-delivery | governance | product | amendment |
tooling | desktop | process | ui | architecture |
constitutional-bootstrap | migration | product-consolidation |
capability | registry | profile
```

### `shape: string` (optional)

Kind-refinement. Validation is table-driven on `(kind, shape)` pairs.

Declared (kind, shape) table:

```
capability + driver
capability + module
capability + web-snippet
capability + middleware-stack
amendment  + field-addition
amendment  + field-modification
amendment  + mechanism-add
amendment  + mechanism-modification
amendment  + bug-fix
amendment  + retirement-record
amendment  + consolidation
```

Other (kind, shape) pairs emit W-131 (informational, non-blocking).

### `category: [string]` (optional)

Free-form list of cross-cutting tags. Conventional vocabulary
(non-binding):

```
security | auth | data | ui | infrastructure | governance |
audit | compliance | identity | lifecycle | policy |
performance | observability | release | testing
```

Values outside conventional vocabulary emit W-130 (warning,
non-blocking).

### `supersedes: [string]` (optional)

Spec ids this spec replaces. Present when this spec is a successor
to one or more predecessors. Each value MUST resolve to an existing
spec id (V-008-equivalent check, kind-agnostic).

### `superseded_by: string` (optional)

Spec id that replaces this spec. Present when `status: superseded`.
MUST resolve to an existing spec id. V-019 enforces presence when
status is superseded.

### `retirement_rationale: object` (optional)

Required when `status: retired` (V-018). Structured record:

```yaml
retirement_rationale:
  reason: obsolete | replaced | withdrawn | merged | archived
  summary: <string, 10–500 chars>
  references: [<spec-id>]  # optional, related context
```

### `implements: <variant>` (optional)

Two parsing variants disambiguated by YAML type:

**Variant A — scalar string** (valid only when `kind: capability`):

```yaml
implements: <registry-spec-id>
```

Declares this capability satisfies the named registry's
`member_contract:`. V-014 enforces shape; V-015 enforces target
resolution.

**Variant B — list of records** (valid for any kind):

```yaml
implements:
  - path: <path-string>
    primary: true   # optional, default false
  - path: <path-string>
```

Each item declares a code-path claim. `primary: true` marks the
authoritative implementation for reverse code → spec attribution.

V-016 enforces a corpus-wide invariant: for any given path,
at most one spec across the corpus declares `primary: true`.
This makes primary ownership of a path a typed question with a
deterministic answer.

## Per-kind structural extensions

The following fields are defined only for the three new kinds.
Their presence on specs of other kinds is silently consumed into
`extraFrontmatter` (subject to the 8-key cap).

### When `kind: capability`

Required (V-013):

```yaml
implements: <registry-spec-id>    # see Variant A above
provides:
  registrations:
    - kind: api | auth-driver | side-effect | auth-export | web-snippet
      # kind-specific fields per registration kind
  files: [<path-glob>]
  env_vars:
    - key: <string>
      required: <bool>
      default: <string>  # optional
      description: <string>
      sensitive: <bool>  # optional, default false
composition:
  requires: [<spec-id>]
```

Optional:

```yaml
selectable_by: <env-var-name>     # SHOULD be set when capability is one of N implementations
composition:
  soft_requires: [<spec-id>]      # capabilities read as fallback but not strictly required
  conflicts: [<spec-id>]          # mutual-exclusion declarations
```

When `shape: web-snippet` is declared, at least one entry under
`provides.registrations[]` MUST have `kind: web-snippet` — V-013
links the two `web-snippet` occurrences so the shape and
registration enums cannot drift.

### When `kind: registry`

Required (V-013):

```yaml
selector: <env-var-name>
member_contract: <spec-id-or-trait-name>
```

Optional:

```yaml
default: <string>
production_forbidden: [<string>]
```

### When `kind: profile`

Required (V-013):

```yaml
identity:
  name: <string>
  jurisdiction: <string>           # ISO 3166 code or free-form
  citizen_term: <string>           # "Albertan", "citizen", "user", etc.
  contacts:
    - role: <string>
      email: <string>
  urls:
    public: <url>
    internal: <url>                # optional
selects:                            # top-level: constraint resolution, not a graph edge
  <registry-spec-id>: <capability-spec-id>
composition:
  requires: [<capability-spec-id>]  # foundational capabilities required regardless of selection
```

Optional:

```yaml
composition:
  conflicts: [<capability-spec-id>] # mutual-exclusion against capabilities the profile would otherwise admit
policy:
  # Free-form policy values applied by the profile.
  # Validation against selected capabilities' declarations is
  # performed by the policy-kernel at runtime, not at compile time.
  # The compiler validates only structural shape, not semantic
  # content.
```

`selects:` stays at top level deliberately. It is structurally a
map (registry-id → capability-id) representing constraint
resolution; the `composition:` namespace is reserved for
list-shaped dependency-graph fields, not for constraint maps.

## Reserved validation slots

V-020 through V-024 are reserved by this amendment for future
extensions of per-kind structural validation (five slots).
Anticipated allocations: `provides.registrations` per-kind
consistency; `env_vars` key-uniqueness within a spec;
`selectable_by` / `selector` equality if not folded into V-015;
`member_contract` resolution; profile `composition.requires`
resolution. If a future amendment exhausts the range, allocate
forward (V-030+) rather than expanding the reservation. Per spec
132's reserved-slot convention, populating these slots in a
future amendment makes the content unamendable — so the
reservation is kept tight on purpose.

## Backward compatibility

- Specs without `kind:` continue to compile. V-012 fires only
  when `kind:` is declared with a value outside the enum.
- Specs declaring legacy `implements:` items without `primary:`
  flags continue to compile. The codebase-index falls back to
  the any-one-claimant heuristic.
- The existing `extraFrontmatter` mechanism continues to receive
  ad-hoc keys subject to the 8-key cap. Specs that declared
  `superseded_by:`, `supersedes:`, etc. before this amendment
  (e.g. specs 038, 040, 044, 088) move those keys from
  `extraFrontmatter` into top-level FeatureRecord fields without
  source spec changes — the compiler routes by KNOWN_KEYS
  membership.

## Determinism

All new validators are pure functions of canonicalized corpus
input. Per-spec validators (V-012, V-013, V-014, V-018) read only
the spec under validation. Corpus-function validators (V-015,
V-016, V-017, V-019) read every spec's frontmatter in the spec
compiler's deterministic walk order — they are still pure
functions, but their input set is the whole corpus, not a single
spec. No network I/O, no time-based logic, no environment-variable
sensitivity. Canonicalization (UTF-8, sorted keys, sorted arrays,
LF newlines) is preserved per spec 000's determinism-requirement
anchor.

## Build-meta impact

`.derived/spec-registry/registry.json`'s top-level `specVersion`
field bumps from `"1.4.0"` to `"1.5.0"`. The schema-version gate
in tools/spec-spine/spec-code-coupling-check (line 165) accepts minor-version
bumps without code change per its existing rules.
