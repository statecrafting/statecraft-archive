# factory-encore documentation website

This directory contains the [Docusaurus v3](https://docusaurus.io/) documentation site for `factory-encore`.

## Local Development

Install dependencies:

```bash
npm install
```

Start the local development server (opens a browser window with hot-reload):

```bash
npm run start
```

## Build

Generate the static production build:

```bash
npm run build
```

This command generates static content into the `build/` directory.

## Serve

Preview the production build locally:

```bash
npm run serve
```

## Deployment

The site is deployed to GitHub Pages automatically via the `.github/workflows/deploy-docs.yml` workflow whenever changes are pushed to `main` in the `website/` directory.

To enable deployment, the repository's **Settings > Pages** must be configured with "GitHub Actions" as the source.
