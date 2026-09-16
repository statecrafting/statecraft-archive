# Spec Corpus

The `specs/` directory contains the foundational specifications that govern **acme-vue-encore**. Below is a summary of the core specs.

## Core Specifications

- **`000-bootstrap`**: The constitutional spec. It establishes the spec-spine governance contract, the compilation process, and the coupling gate.
- **`001-monorepo-structure`**: Defines the physical layout of the repository, including the npm workspaces and the standalone Encore API.
- **`002-security-invariants`**: The most critical technical spec. It defines the eleven non-negotiable security invariants (INV-1 through INV-11) that protect the application.
- **`003-auth-model`**: Details the stateless JWT authentication model, the multi-driver SSO implementation, and the refresh token rotation mechanism.
- **`004-gateway-proxy`**: Defines the Backend-for-Frontend (BFF) proxy contract, including S2S token injection and error masking.
- **`005-frontend-architecture`**: Specifies the Vue 3 SPA architecture, the use of PrimeVue, and the dual-SPA layout.
- **`006-encore-client`**: Governs the integration between the frontend and backend via the generated, strongly-typed Encore client.
- **`011-ci-pipeline`**: Defines the continuous integration requirements, including testing, linting, and the spec-spine gate.
- **`012-deployment-strategy`**: Details the supported deployment paths, including the recommended Encore container path.
- **`015-workflow-pins`**: Enforces the security policy that all third-party GitHub Actions must be pinned by their SHA-1 hash.

## Reading the Specs

Each spec is a markdown file with a strict YAML frontmatter block. The frontmatter defines:
- `id`: The unique identifier.
- `title`: A descriptive title.
- `status`: The current status (e.g., `approved`, `draft`).
- `owner`: The GitHub handle of the spec owner.
- `implementation`: The implementation status (`complete`, `partial`, `pending`).

When modifying the repository, you should always consult the relevant spec to ensure your changes align with the established design.
