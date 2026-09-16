# Security Policy

Security is the foundational premise of **acme-vue-encore**. The repository is designed to be secure by default, governed by the eleven invariants defined in spec 002.

## Reporting a Vulnerability

If you discover a security vulnerability in this repository, please **do not** open a public issue.

Instead, please report it privately via GitHub Security Advisories or by contacting the repository maintainers directly.

## Security Invariants

Before reporting a vulnerability, please review the [Security Invariants](../concepts/security-invariants.md) documentation. The architecture explicitly relies on these invariants (e.g., stateless JWTs, CSRF double-submit, parameterized queries).

If you find a bypass to any of these invariants (for example, a way to inject SQL despite the tagged-template requirement, or a way to bypass the gateway proxy), this is considered a critical vulnerability.

## Dependency Security

We rely on Dependabot to monitor dependencies for known vulnerabilities.

Because of the strict spec-spine coupling gate, mechanical dependency updates (where only version strings in `package.json` change) are automatically waived by the `spec-spine.toml` configuration (`auto_waive_dependency_only = true`). This ensures that security patches can be merged quickly without requiring manual specification updates.
