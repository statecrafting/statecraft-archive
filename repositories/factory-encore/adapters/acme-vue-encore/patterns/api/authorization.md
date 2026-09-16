# Pattern: authorization

Authorization is enforced on the server, from the application's own role data.
The auth handler validates the bearer token and exposes identity through
`getAuthData()`; endpoints check roles before acting.

## Where roles come from

The auth handler validates the OIDC token (rauthy) against the issuer JWKS and
maps the token's `roles` and `groups` claims to application roles, falling back
to `RAUTHY_DEFAULT_ROLE`. The mapped roles are what `getAuthData()` returns. The
token claims are the source of identity; the application decides what those
roles may do.

## Conventions

- Every authenticated endpoint calls `getAuthData()` and, where the operation
  declares `required_roles`, checks them with a shared helper.
- A failed check throws `APIError.permissionDenied`, never a silent pass.
- The UI may hide controls by role, but that is cosmetic; the server is the
  authority.

## Example

`apps/api/lib/roles.ts`:

```ts
import { APIError } from "encore.dev/api";
import type { AuthData } from "~encore/auth";

export function requireRole(auth: AuthData, allowed: string[]): void {
  const has = auth.roles.some((r) => allowed.includes(r));
  if (!has) {
    throw APIError.permissionDenied("Insufficient role for this operation.");
  }
}
```
