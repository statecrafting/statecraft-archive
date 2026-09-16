# Authentication Model

The **acme-vue-encore** authentication model is strictly stateless, relying on JSON Web Tokens (JWT) rather than server-side sessions. It does not use `express-session` or Redis for session storage.

## Stateless JWT Lifecycle

The system issues two types of tokens upon successful login:

1. **Access Token**: A short-lived (15-minute) RS256-signed JWT containing the user's identity and roles. It is stored in an `httpOnly`, `secure` cookie.
2. **Refresh Token**: A longer-lived (7-day) token used to obtain new access tokens without requiring the user to log in again.

### Refresh Token Security

To mitigate the risks associated with long-lived tokens, the refresh token implementation adheres to strict security invariants (INV-7):

- **Hash-Only Storage**: The raw refresh token is never stored in the database. Only its SHA-256 hash is persisted in the `refresh_token` table.
- **Rotation**: Every time a refresh token is used, it is rotated. A new refresh token is issued, and the old one is marked as replaced.
- **Revocation**: Refresh tokens can be revoked server-side (e.g., during logout), immediately invalidating the session family.

## Cross-Site Request Forgery (CSRF) Protection

Because the application uses cookies for authentication, it must protect against CSRF attacks. The system employs a double-submit cookie pattern:

1. The client requests a CSRF token from `/api/v1/auth/csrf-token`.
2. The server issues a signed token and sets a corresponding cookie.
3. For all state-changing requests (POST, PUT, PATCH, DELETE), the client must include the token in the `X-CSRF-Token` header.
4. The `csrfMiddleware` validates that the header matches the signed cookie.

## Multi-Driver SSO

The `auth` service supports multiple Single Sign-On (SSO) drivers, allowing the application to integrate with different identity providers.

- **Mock Driver**: Used for local development and testing. It provides instant login as predefined personas (Developer, Administrator, Standard User) without requiring an external Identity Provider (IdP).
- **Rauthy Driver**: The production-ready OpenID Connect (OIDC) driver, configured to integrate with a self-hosted [rauthy](https://github.com/sebadob/rauthy) instance.

The active driver is determined by the `AUTH_DRIVER` environment variable. Regardless of the driver used, the application normalizes the user identity into a consistent internal representation, resolving roles from token claims or falling back to a default role (`RAUTHY_DEFAULT_ROLE`). Roles are treated as an any-of set, never as a strict privilege hierarchy.
