# Security Policy

This template ships authentication and authorization machinery (stateless RS256
JWT, multi-driver SSO, a BFF proxy, CSRF and security-header middleware). If you
believe you have found a vulnerability in the template itself, please report it
responsibly.

## Reporting a vulnerability

- Use GitHub's private vulnerability reporting ("Report a vulnerability" under
  the repository Security tab) where available, or open a minimal private
  channel with the maintainer.
- Do **not** open a public issue for an undisclosed vulnerability.
- Please include: affected files or endpoints, a reproduction or proof of
  concept, the impact, and any suggested remediation.

Replace this section with your organization's disclosure contact and SLA before
operating the template in production.

## Scope

In scope:

- Auth flows (`apps/api/auth/**`): driver logic, token issuance, refresh
  rotation and revocation, CSRF.
- The BFF gateway proxy (`apps/api/gateway/**`).
- Security primitives in `apps/api/lib/**` (cookies, JWT, CSRF,
  security headers, rate limiting, audit, PII-redacting logger).
- The security and data invariants frozen in `specs/002-security-data-invariants`.

Out of scope:

- Vulnerabilities in third-party dependencies (report upstream; we will bump).
- Misconfigurations in a downstream fork's own secrets, identity provider, or
  deployment.

## Handling secrets

This repository contains **no real secrets**. The committed `.env.*.example`
files hold placeholders only; real keys and credentials are gitignored
(`.env`, `*.pem`, `*.key`). Never commit live credentials. JWT signing keys are
generated locally (`npm run generate-keys` in `apps/api`) and supplied through
the platform secret store in production.
