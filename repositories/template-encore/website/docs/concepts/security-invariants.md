# Security Invariants

The **acme-vue-encore** architecture is strictly governed by a set of security and data invariants defined in **spec 002**. These invariants form the non-negotiable baseline for all development within the repository.

The primitives enforcing these invariants are centralized in `apps/api/lib/` and `apps/api/db/`, ensuring consistent application across all services.

## The Invariants

1. **INV-1: Role-Scoped Data Access**: Roles are an any-of set, never a privilege hierarchy. Every protected endpoint must explicitly verify roles using `requireRole(auth, ...)`. Data queries must be scoped to the authenticated user's roles (`auth.roles`).
2. **INV-2: Parameterized Queries Only**: All database access must use Encore's tagged-template queries (e.g., `db.query\``). String concatenation for SQL is strictly forbidden to prevent SQL injection.
3. **INV-3: Stateless Authentication**: The application must not use server-side sessions (e.g., `express-session`). All authentication state is carried in stateless JWTs.
4. **INV-4: Secure Cookies**: Authentication tokens must be stored in `httpOnly`, `secure`, `SameSite=Lax` cookies to mitigate XSS and CSRF risks.
5. **INV-5: CSRF Double-Submit**: All state-changing requests must include a valid CSRF token in the `X-CSRF-Token` header, validated against a signed cookie.
6. **INV-6: Rate Limiting**: Critical endpoints (especially authentication) must be rate-limited. Redis may be used as a rate-limit backend, but never as a session store.
7. **INV-7: Refresh Token Security**: Refresh tokens must be stored hash-only in the database. They must be rotated on every use and be server-side revocable.
8. **INV-8: Comprehensive Audit Trail**: All significant actions (including gateway access) must be logged to the `audit_log` table with the actor, action, and outcome.
9. **INV-9: Normalized Principal**: Regardless of the SSO driver used (`mock` or `rauthy`), the user identity must be normalized into a consistent representation in the `user_account` table.
10. **INV-10: BFF Proxy Contract**: The frontend must never communicate directly with the private backend. The `gateway` service proxies requests, injecting a service-to-service token and masking upstream 5xx errors.
11. **INV-11: PII Redaction**: Personally Identifiable Information (PII) must never be logged. The logger automatically redacts PII. In production, `LOG_PII` must be set to `false`, or the application will fail fast on startup.

## Enforcement

These invariants are not merely guidelines; they are enforced mechanically. The `lib/` directory provides the necessary middleware (`csrfMiddleware`, `apiRateLimit`, `securityHeaders`), and the spec-spine coupling gate ensures that any changes to these foundational primitives require corresponding updates to the specifications.
