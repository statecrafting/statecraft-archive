# acme-vue-encore documentation website

This directory contains the Docusaurus v3 documentation site for acme-vue-encore.

## Local development

```bash
cd website
npm install
npm run start
```

This starts a local dev server at `http://localhost:3000/template-encore/` and opens a
browser window. Most changes are reflected live without restarting the server.

## Build

```bash
npm run build
```

This generates static content into the `build/` directory. The build enforces
`onBrokenLinks: 'throw'`, so any broken internal link fails the build.

## Deployment

The site deploys automatically to GitHub Pages via the
`.github/workflows/deploy-docs.yml` workflow on pushes to `main` that touch
`website/**`.

**Setup requirement:** In the repository Settings, under Pages, set the source
to "GitHub Actions" (not "Deploy from a branch").

## Stack

- [Docusaurus v3](https://docusaurus.io/) (classic preset, TypeScript)
- [Mermaid](https://mermaid.js.org/) for diagrams (`@docusaurus/theme-mermaid`)
- GitHub Pages for hosting
