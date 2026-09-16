# Lifecycle and Status

Specifications in OAP are living documents, but they move through a strict lifecycle defined in their frontmatter.

## Status

The `status` field indicates the governance state of the spec:

- **`draft`**: The spec is being written or reviewed. It does not yet carry authority.
- **`approved`**: The spec has been ratified. It is now the authoritative truth for the features it describes.
- **`superseded`**: The spec has been replaced by a newer spec (indicated by the `supersedes` edge in the newer spec's frontmatter).
- **`retired`**: The spec is no longer active, and its features have been removed from the system.

## Implementation

The `implementation` field tracks the state of the code that fulfills the spec:

- **`partial`**: The code is actively being written, or only some of the claimed paths exist.
- **`complete`**: The code fully implements the approved specification.

## The Approval Process

A spec moves from `draft` to `approved` via a pull request review. Because OAP enforces spec-first development, it is common to see a PR that only contains a new `draft` spec.

Once the spec is `approved`, subsequent PRs will add the code. The Coupling Gate ensures that the code paths created in these PRs are correctly claimed by the `approved` spec.
