# Backend Services

The Encore.ts backend (`apps/api`) is decomposed into six distinct logical services. Encore auto-discovers these services based on the presence of an `encore.service.ts` file within each directory. There is no central route registry or `app.ts` file to maintain.

## The Six Services

### 1. `lib`
The `lib` service provides the shared security and utility primitives that all other services rely on. It does not expose any API endpoints. It owns:
- Secret declarations via Encore's `secret()`.
- Shared middleware (e.g., CSRF protection, security headers, rate limiting).
- JWT lifecycle utilities.
- The redaction-aware logger.

### 2. `db`
The `db` service encapsulates persistence. Like `lib`, it has no endpoints. It manages:
- The single `SQLDatabase("app")` instance.
- Database migrations located in `apps/api/db/migrations/`.

### 3. `health`
The `health` service exposes endpoints for monitoring and diagnostics. It provides:
- Liveness and readiness probes (`/health/liveness`, `/health/readiness`).
- Application metadata (`/api/v1/info`).
- A sink for Content Security Policy (CSP) violation reports (`/api/v1/csp-report`).

### 4. `auth`
The `auth` service handles all authentication and authorization logic. It features:
- A dual-mode `authHandler` (handling both session cookies and Bearer tokens) and the corresponding `Gateway`.
- Multi-driver Single Sign-On (SSO), supporting both `mock` and `rauthy` OIDC drivers.
- JWT issuance, refresh token rotation, and revocation.

### 5. `gateway`
The `gateway` service implements the Backend-for-Frontend (BFF) proxy pattern. It provides:
- An `api.raw` catch-all route at `/api/v1/data/*`.
- Proxying of authenticated requests to a private backend, injecting a service-to-service OAuth client-credentials token.
- Error masking (converting upstream 5xx errors to 502) and timeout handling.

### 6. `web`
The `web` service is responsible for serving the built frontend application. It uses:
- Encore's `api.static` to serve the Vue SPA from the `build` directory.
- A `/!path` fallback mechanism to support Vue Router's history mode.
