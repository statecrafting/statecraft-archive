# Data and Persistence

Persistence in **acme-vue-encore** is handled exclusively through Encore's native PostgreSQL integration.

## `SQLDatabase("app")`

The backend uses a single Postgres database instance, declared in the `db` service as `SQLDatabase("app")`. During local development with `encore run`, Encore automatically provisions and manages this database using Docker. In production, it connects to the configured Postgres cluster.

## Migrations

The database schema is defined and evolved using raw SQL migration files located in `apps/api/db/migrations/`.

The foundational migrations include:
1. **`1_extensions.up.sql`**: Enables necessary Postgres extensions like `pgcrypto` (for UUID generation) and `citext` (for case-insensitive emails).
2. **`2_user_account.up.sql`**: Creates the `user_account` table, which normalizes user identities across all SSO providers.
3. **`3_refresh_token.up.sql`**: Creates the `refresh_token` table, storing only SHA-256 hashes of the tokens to satisfy INV-7.
4. **`4_audit_log.up.sql`**: Creates the `audit_log` table, providing a durable trail of significant actions (INV-8).

Encore automatically applies these migrations on startup. For self-hosted deployments outside of Encore's managed cloud, a standalone migration runner is provided (`npm run db:migrate`).

## The Query Contract (INV-2)

To prevent SQL injection vulnerabilities, all database access must use Encore's tagged-template query syntax.

```typescript
// Correct: Parameterized tagged-template query
await db.queryRow`SELECT id, email FROM user_account WHERE email = ${email}`;
```

String concatenation or interpolation for SQL construction is strictly forbidden (INV-2).

## Redis is for Rate Limiting Only

If Redis is configured (`REDIS_URL`), it is used **exclusively** as a backend for the rate limiter (`lib/rate-limit.ts`) to satisfy INV-6.

Redis is **not** used as a session store or an authentication cache. The application's authentication model is entirely stateless (INV-3), relying on JWTs and the Postgres-backed `refresh_token` table.
