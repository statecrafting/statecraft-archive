# Stage 03: Data Model

**Sequence:** 3
**Agent:** data-architect
**Mutation:** read-only (writes requirement artifacts)

## Purpose

Refine the raw entity model into a normalized, constraint-complete data model.
This stage adds the structure a database needs (keys, types, references,
constraints, indexes) while staying technology-agnostic: no SQL, no table names,
no ORM.

## Inputs

- `requirements/entity-model.json` (Stage 1)
- `requirements/business-rules.json` (Stage 1)
- `requirements/audiences.json` (Stage 2)

## Outputs

- `requirements/data-model.json`: normalized entities. Each field has a type
  from the contract's type set, plus required, unique, default, and (for
  references) the target entity and on-delete behavior. Entities carry composite
  unique constraints, check constraints expressed as business rules, and indexes.
  Relationships that do not fit a simple reference (many-to-many, junctions) are
  listed explicitly.

## Gates

The Stage 3 gate must pass before Stage 4 starts:

- `S3-001` Entities are normalized; repeating groups are factored into their own
  entities.
- `S3-002` Every field has a declared type, and every reference names a valid
  target entity and an on-delete behavior.
- `S3-003` Foreign-key fields are indexed.

## Notes

Enumerations are modeled as the contract's `enum` type with explicit
`enum_values`, not as free strings, so Stage 4 can align API enum values to the
data model exactly.
