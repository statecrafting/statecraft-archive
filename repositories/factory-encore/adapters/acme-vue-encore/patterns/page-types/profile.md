# Page type: profile

The signed-in user's own profile: identity from the session and editable
preferences.

## Build it with

- Read identity from `GET /api/v1/auth/me`; do not decode tokens in the browser.
- PrimeVue `Card` for identity, a form section for editable fields, and a sign-out
  action.
- Edits submit through the typical form flow (CSRF, server authorization).

## Auth

`requires_auth: true`. A user may read and edit only their own profile; the
server scopes every read and write to the authenticated subject.
