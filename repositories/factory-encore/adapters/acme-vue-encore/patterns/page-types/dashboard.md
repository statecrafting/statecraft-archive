# Page type: dashboard

An authenticated overview: summary metrics and recent items, with links into
detail and list pages.

## Build it with

- PrimeVue `Card`s for metric tiles and a compact `DataTable` for recent items.
- One or more read operations triggered `on-load`; show a spinner while loading.

## Auth

Usually `view_type: private-authenticated` (internal/admin) or
`public-authenticated` (a signed-in attendee's home). Set `requires_auth: true`
and the `required_roles` from the Build Spec. Role-based tiles may be hidden in
the UI, but the server authorizes each underlying operation.
