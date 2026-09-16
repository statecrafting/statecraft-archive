# Page type: list

A table of records with optional filtering, sorting, and paging, and links to the
detail or form pages for each row.

## Build it with

- PrimeVue `DataTable` + `Column`, with `paginator` and `sortable` columns.
- A single list/paginated operation triggered `on-load`; row actions navigate to
  the detail page or invoke an `on-action` operation.
- Render loading and empty states.

## Auth

`requires_auth` and `view_type` follow the audience. List operations are usually
read; mutating row actions carry CSRF and are authorized server-side.
