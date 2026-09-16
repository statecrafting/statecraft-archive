# API Endpoints

This document lists the core API endpoints exposed by the Encore backend. Note that Encore automatically discovers and exposes these based on the `api()` and `api.raw()` declarations in the service files.

## Health and Metadata (`health` service)

- **`GET /health/liveness`**: Returns 200 OK if the process is up. Does not check dependencies.
- **`GET /health/readiness`**: Returns 200 OK if the database is reachable. Returns 503 if not.
- **`GET /health`**: A composite health check.
- **`GET /api/v1/info`**: Returns application metadata (name, version, environment).
- **`POST /api/v1/csp-report`**: Sink for Content Security Policy violation reports. Unauthenticated.

## Authentication (`auth` service)

- **`GET /api/v1/auth/csrf-token`**: Returns a new CSRF token and sets the corresponding cookie.
- **`GET /api/v1/auth/me`**: Returns the currently authenticated user's identity and roles. Requires authentication.
- **`POST /api/v1/auth/logout`**: Revokes the refresh token and clears all authentication cookies.

### SSO Endpoints (Driver Dependent)

- **`GET /api/v1/auth/login`**: Initiates the login flow. Redirects to the configured Identity Provider (IdP).
- **`GET /api/v1/auth/callback`**: The generic callback endpoint.
- **`GET /api/v1/auth/rauthy/callback`**: The specific callback endpoint for the Rauthy OIDC driver.

## BFF Gateway (`gateway` service)

- **`ALL /api/v1/data/*`**: The catch-all proxy route. Forwards authenticated requests to the `PRIVATE_API_BASE_URL`, injecting an S2S token. Requires authentication.

## Static Assets (`web` service)

- **`GET /!path`**: The lowest-priority catch-all route. Serves the built Vue SPA from `apps/api/web/build`. Returns `index.html` for unresolved paths to support Vue Router history mode.
