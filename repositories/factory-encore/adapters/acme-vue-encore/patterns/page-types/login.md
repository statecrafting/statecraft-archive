# Page type: login

The authentication entry point. With OIDC via rauthy, this page does not collect
a username and password; it starts the authorization-code flow.

## Build it with

- A single "Sign in" `Button` that calls the auth store's `login()`, which
  redirects the browser to the backend login route. That route begins the
  authorization-code flow with PKCE against rauthy and returns via the callback.
- A `guest_only` route: signed-in users are redirected away.
- After login, return the user to the `redirect` query parameter if present.

## Auth

`view_type: public`, `requires_auth: false`, `guest_only: true`. Do not build a
local password form; rauthy owns authentication. The mock driver may offer a
dev-only shortcut, never enabled in production.
