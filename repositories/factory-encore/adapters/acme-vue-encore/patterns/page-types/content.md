# Page type: content

A mostly static content page (about, terms, policy). Little or no dynamic data.

## Build it with

- PrimeVue layout components (`Card`, `Panel`) and typographic content.
- No data source, or at most one read operation for content that is managed
  elsewhere.

## Auth

Usually `view_type: public`, `requires_auth: false`. If the content is
internal-only, set the audience and `requires_auth: true` accordingly.
