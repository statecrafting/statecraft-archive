# apps/api: Encore.ts backend

Standalone Encore.ts application (excluded from the root npm workspaces; it has
its own `package-lock.json`). Authoritative specs: `specs/001-encore-app-architecture`
(layout + service decomposition) and `specs/002-security-data-invariants`
(the INV-1..INV-11 security and data guarantees).

## Services

| Service | Role |
|---------|------|
| `lib` | No endpoints; `secret()` declarations, shared middleware, security primitives. |
| `db` | No endpoints; the single `SQLDatabase("app")` and its migrations. |
| `health` | Liveness/readiness probes, `/api/v1/info`, `/api/v1/csp-report`. |
| `auth` | `authHandler` + `Gateway`, multi-driver SSO (mock/rauthy), JWT lifecycle. |
| `gateway` | BFF proxy: `api.raw` catch-all `/api/v1/data/*` to the private backend. |
| `web` | Static SPA serving via `api.static`. |

## Local development

```bash
npm install
npm run generate-keys   # RSA-2048 JWT keypairs into keys/ (gitignored)
npm run dev             # encore run --port=4000 (Docker must be running for Postgres)
npm run typecheck       # encore check (application graph + topology + types)
npm test                # vitest
```

No secret value is committed: `keys/` and `*.pem` are gitignored, and
`infra.config.json` carries only `$env` references.
