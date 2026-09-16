---
id: "001-site-scaffold"
title: "statecraft.ing: React Router v7 static site, Pages deploy, apex cutover"
status: approved
created: "2026-07-14"
implementation: complete
depends_on:
  - "000-bootstrap"
establishes:
  - "package.json"
  - "react-router.config.ts"
  - "vite.config.ts"
  - { kind: directory, path: "app/" }
  - { kind: directory, path: "public/" }
  - { kind: directory, path: "scripts/" }
  - ".github/workflows/deploy.yml"
summary: >
  The marketing and docs site, built as a fully static React Router v7
  app (framework mode, prerendered, no SSR at runtime) deployed to
  GitHub Pages under statecraft.ing. Amended 2026-07-14: React Router
  v7 replaces the earlier Astro choice, harvesting the OAP-era
  statecraft web app (ecosystem content, the spec-registry viewer)
  and keeping the whole product family on one frontend stack. The
  registry viewer runs over build-time-baked shards from the public
  repos, so the site stays static and every claim stays checkable.
  The apex DNS cutover is authorized: the legacy control plane no
  longer owns the domain.
---

# 001: Site scaffold

## 1. Purpose

One public front door for the product family, on the same frontend
stack as the platform (React Router v7; the Astro option was dropped
2026-07-14 to avoid a fourth framework and to reuse existing work).
Static output, zero backend, boring hosting: the site must never be
operational work.

## 2. Harvest source (requires operator-granted read access)

`~/DevWork/open-agentic-platform/platform/services/statecraft/web` is
an RR7 framework-mode app (served by Encore in the legacy plane) with
ecosystem-related content and a spec-registry viewer. Harvest routes,
components, and copy that fit a public static site; leave behind the
Encore serving layer (api.gateway.ts, api.tools.ts, encore.service.ts),
anything auth-coupled, and anything that fetches a live API. The
implementing session needs that path readable
(`claude --add-dir ~/DevWork/open-agentic-platform`); if missing, stop
and report.

## 3. Behavior

- **Stack**: React 19 + React Router v7 framework mode with
  `ssr: false` and prerendering of all static routes; Vite;
  TypeScript strict. No runtime external requests, no analytics, no
  cookies; self-hosted or system fonts. Dark mode via
  prefers-color-scheme.
- **Registry viewer, static edition**: a build step
  (`scripts/bake-registry.mjs`) fetches the public repos'
  `.derived/spec-registry/by-spec/*.json` shards (enrahitu,
  statecraft, statecraft-cli, statecraft.ing) into `public/data/`,
  and the viewer routes render from that baked payload. Enumeration
  amendment (2026-07-14): raw.githubusercontent cannot list a
  directory, so the bake uses the GitHub REST API
  (`api.github.com`) at build time to (a) list each repo's
  `.derived/spec-registry/by-spec` contents and (b) read the
  commit SHA + date of the last commit that touched that path (the
  "as of" stamp), then fetches each shard body from
  raw.githubusercontent. Both hosts are contacted at build time
  only; the emitted site makes no runtime request to either. The
  bake records each repo's SHA + as-of date into the payload so the
  viewer can display "as of". Build fails loudly if any fetch or
  parse fails; no silent partial bakes. The baked payload lives at
  `public/data/registry.json`; the prerender step and the viewer
  loaders read it from disk at build time, so it is embedded in the
  prerendered HTML/`.data` (and also served as a same-origin static
  asset).
- **Structure**: base layout (wordmark, repo links, footer with
  license notes), index (content per spec 002), `/registry` (the
  viewer), `/docs` (markdown content collection with one placeholder
  page in this spec).
- **Deploy** (`.github/workflows/deploy.yml`, SHA-pinned actions
  with version comments): on push to main, build + upload-pages-artifact
  + deploy-pages (permissions pages:write, id-token:write, environment
  github-pages). Pages is ALREADY ENABLED on this repo with
  build_type=workflow (done 2026-07-14); no operator action needed for
  the default URL (https://statecrafting.github.io/statecraft.ing/).
  Base-path amendment (2026-07-14): because `public/CNAME` ships in
  the build (the apex is the authorized canonical home), the site is
  built at base path `/` (apex root), not the `/statecraft.ing/`
  project sub-path. GitHub Pages redirects the default
  `*.github.io/statecraft.ing/` URL to the apex once the custom
  domain is verified; the two cutover steps below run in the same
  session as the first deploy so that window stays short.
- **Apex cutover (authorized 2026-07-14)**: the legacy control plane
  currently behind statecraft.ing is abandoned; after the FIRST
  successful Pages deploy, complete the cutover in this order:
  1. `public/CNAME` containing `statecraft.ing` ships with the build.
  2. Set the Pages custom domain:
     `gh api -X PUT repos/statecrafting/statecraft.ing/pages -f cname=statecraft.ing`.
  3. Update Cloudflare DNS using the API token at
     `~/.config/oap/infra/hetzner/.env` (`CLOUDFLARE_DNS_API_TOKEN`;
     read it, never echo it): replace the apex A/AAAA records with a
     CNAME to `statecrafting.github.io` (Cloudflare flattens at
     apex), DNS-only (not proxied) until the GitHub certificate
     issues, then optionally re-enable the proxy.
  4. Verify `https://statecraft.ing` serves the site with a valid
     certificate; record the cutover date in this spec via amendment.
  If the Cloudflare token lacks DNS-edit rights for the zone, stop
  and report the exact API error.

## 4. Acceptance

- `npm ci && npm run build` emits a fully static dist (prerendered
  HTML + assets + baked registry data); `npm run dev` serves layout,
  index placeholder, `/registry` rendering real baked shards, and the
  docs placeholder.
- Deploy workflow green; the default Pages URL serves the site; after
  cutover, `https://statecraft.ing` serves it with a valid cert.
- No console errors; dark mode renders; the built output makes zero
  runtime requests to any non-same-origin host.
- Spine gates green (`spec-spine lint --fail-on-warn`, `index check`).

## 5. Out of scope

- All real copy and information architecture (spec 002).
- Blog, search, versioned docs, OG image generation.
- Any server-side rendering at runtime, forms, or API calls.
- Migrating the legacy plane's other routes; the domain simply moves.

## 6. Status (2026-07-14): complete, live at https://statecraft.ing

Implemented, verified, deployed, and cut over to the apex.

Local + CI green: `npm ci`, `npm run build` (bakes 39 shards from the
four public repos and prerenders every route into a static
`build/client`), `npm run dev` (serves the layout, the index
placeholder, `/registry` over real baked shards, and the docs
placeholder), `npm run typecheck`, and the spine gates (`compile`,
`index`, `lint --fail-on-warn`, `index check`, `couple`). The built
output loads no off-origin resource (system fonts, registry data baked
in, no analytics, no webfont CDN).

Deploy + apex cutover done 2026-07-14:
- `.github/workflows/deploy.yml` ran green on push (build + Pages
  deploy); the CI bake fetched the four repos' shards.
- Pages custom domain set to `statecraft.ing`; the apex A record
  (legacy plane, `178.104.146.181`, proxied) was converted to a
  DNS-only Cloudflare CNAME to `statecrafting.github.io` (email,
  NS, `www`, and the other subdomains left untouched).
- GitHub issued a Let's Encrypt certificate (`CN=statecraft.ing`,
  valid 2026-07-15 to 2026-10-13); Enforce HTTPS is on.
- Verified live over HTTPS (200): `/`, `/registry/` (real baked
  shards), `/docs/`, and spec detail pages.

Note on acceptance "no console errors / dark mode renders": verified
by construction, not by a live browser session (the local Chrome
bridge was unavailable). Basis: the prerender+build emitted no errors;
hydration is deterministic and mismatch-safe (`suppressHydrationWarning`
on `<html>`, class-based theme with no client render state, pages
render from static loader data); every referenced asset is same-origin
and present; the built output makes zero off-origin requests. Dark mode
is wired via `prefers-color-scheme` plus a no-flash init script and the
`.dark` class (present in the built CSS with `color-scheme`).

Optional follow-up (not required by acceptance): re-enable the
Cloudflare proxy on the apex now that the GitHub certificate has
issued (§3 step 3).
