# Page type: landing

A public entry page. No authentication; introduces the service and links into the
authenticated areas.

## Build it with

- A hero section and call-to-action `Button`s, and PrimeVue `Card`s for feature
  highlights.
- No data source is required; if it shows live counts, it calls a single public
  list operation read-only.

## Auth

`view_type: public`, `requires_auth: false`. Visible to everyone, including
signed-out visitors. Sign-in is offered, not required.
