# Page type: form

A create or edit form that submits to one operation.

## Build it with

- PrimeVue inputs (`InputText`, `Select`, `Checkbox`, `Textarea`, `DatePicker`)
  bound to a typed model.
- Validate inputs before submit; show field errors with PrimeVue `Message`.
- Submit `on-submit` to the page's operation; the mutation carries the CSRF
  token. On success, navigate to the detail or list page; on error, surface the
  server message.

## Auth

`requires_auth: true` for create/edit of owned or privileged records. The server
re-validates input and authorizes the write; client validation is a convenience.
