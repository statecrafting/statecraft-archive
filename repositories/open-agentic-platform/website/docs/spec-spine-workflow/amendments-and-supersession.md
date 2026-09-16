# Amendments and Supersession

As the platform evolves, specifications must change. OAP provides two mechanisms for updating the authoritative record: Amendments and Supersession.

## Amendments (`amends:`)

An amendment is a non-replacing patch to a predecessor spec. It is used for clarifications, corrections, or minor restrictions that do not fundamentally alter the original design.

When you amend a spec, you do not modify the original `spec.md` directly. Instead, you create a new spec that declares an `amends:` relationship to the original.

```yaml
amends:
  - spec: "102-governed-excellence"
    nature: "correction"
```

The original spec remains `approved` and authoritative, but the compiler merges the amendment's changes into the derived view of the original spec.

## Supersession (`supersedes:`)

Supersession is the replacement of a predecessor spec. It is used when a feature is completely redesigned or when an architectural approach is abandoned.

A superseding spec declares its relationship in the frontmatter:

```yaml
supersedes:
  - spec: "038-titor-tauri-command-wiring"
    scope: full
```

When a spec is fully superseded, its status in the registry changes to `superseded`, and it loses its authority over the codebase. The Coupling Gate transfers authority for the claimed code paths to the new, superseding spec.

## Invariant Freeze

Some specs declare constraints that cannot be amended or superseded through normal channels. For example, Spec 132 (`constitutional-invariant-freeze`) declares an `unamendable` list of validation rules.

If a developer attempts to author an amendment that violates one of these frozen invariants, the `spec-lint` tool and the Coupling Gate will reject the change. This ensures that foundational constitutional principles remain intact regardless of future agentic or human actions.
