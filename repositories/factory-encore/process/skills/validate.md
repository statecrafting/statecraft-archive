# Skill: validate

Process-level validation rules that apply across adapters. These are
factory-owned checks, distinct from the adapter-owned build and test gates. The
rule below binds to the Stage 1 quality gate.

## External entity provenance

Every claim that names an external entity (an organization, system, product, or
other proper noun not on the run's allowlist) must resolve to one of:

- **Derived**: a citation to the source documents, with a content hash that the
  validator can verify against the extracted corpus, or
- **Assumption**: an explicit assumption tag with an owner, a rationale, and an
  expiry (at most 90 days), or
- **Rejected**: recorded as rejected, which fails the Stage 1 gate in strict
  mode.

### Modes

- **Strict** (default): a rejected claim fails the gate and halts the pipeline.
- **Permissive** (explicit opt-in, audit-logged): a rejected claim warns and
  requires a recorded reason.

A workspace policy may pin strict mode globally.

### Why this is a separate validator

The check is mechanical and must not depend on the model that produced the
claim. It runs as its own validator over the extracted corpus, so the artifact
under review cannot vouch for itself. The model proposes; the validator
disposes.
