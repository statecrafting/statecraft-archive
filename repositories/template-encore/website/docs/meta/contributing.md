# Contributing

Thank you for your interest in contributing to **acme-vue-encore**. Because this repository serves as a strict reference architecture, contributions must adhere to specific governance rules.

## The Golden Rule: Specs First

This repository uses a "born-with" spec spine. Every substantive change to the architecture, security model, or core features must begin as a specification.

If you submit a pull request that modifies code governed by a spec without updating the corresponding spec, the CI pipeline's coupling gate will reject the PR.

### How to Propose a Change

1. **Open an Issue**: Discuss the proposed change before writing code.
2. **Draft a Spec**: If the change is significant, write or update a markdown specification in the `specs/` directory.
3. **Compile the Index**: Run `npx spec-spine compile` to update `specs/spec-spine-index.json`.
4. **Implement the Code**: Write the code that implements the specification.
5. **Run Local Validation**: Ensure all tests and linting pass (`npm run test:unit`, `npm test` in `apps/api`).
6. **Submit a PR**: Submit your pull request, ensuring the spec changes and code changes are in the same diff.

## Code Style

- **Frontend**: Vue 3 Composition API (`<script setup>`), TypeScript, PrimeVue.
- **Backend**: Encore.ts, strict TypeScript, parameterized queries only.
- **Formatting**: The project uses Prettier. Run `npm run format` before committing.

## Pull Request Process

1. Ensure your PR targets the `main` branch.
2. Ensure the CI pipeline passes (Encore CI and Spec-Spine checks).
3. A repository maintainer will review your PR for architectural alignment and security invariants.
