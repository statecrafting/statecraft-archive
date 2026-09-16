# Page type: detail

A single record view, optionally with related records and actions (for example
confirm, cancel, edit).

## Build it with

- PrimeVue `Card`/`Panel` for the record fields; `Tag`/`Badge` for status.
- A get-by-id operation triggered `on-load` from the route param; actions invoke
  `on-action` operations and refresh.
- Render not-found and error states.

## Auth

Follows the audience. Action buttons are shown by role for convenience; the
server authorizes the action and enforces the record's business rules (for
example the status state machine).
