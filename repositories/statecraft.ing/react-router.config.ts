import type { Config } from "@react-router/dev/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DOC_STUBS } from "./app/lib/docs";
import { readerPapers } from "./app/lib/papers";

// Static site, framework mode. `ssr: false` means no runtime server; every
// route is prerendered to HTML at build time (loaders run in Node during the
// build). The apex (statecraft.ing) is the canonical home, so the site is
// built at base path "/" (see vite.config.ts) and CNAME ships in public/.

// Enumerate the dynamic registry detail routes from the baked payload so the
// prerenderer emits one static page per governed spec across all repos. The
// bake step (npm run bake:registry) writes this file before the build runs;
// if it is somehow absent, the index still prerenders and detail pages are
// simply skipped rather than failing the whole build.
function registryDetailPaths(): string[] {
  const dataPath = path.join(process.cwd(), "public", "data", "registry.json");
  try {
    const data = JSON.parse(readFileSync(dataPath, "utf8")) as {
      repos?: Array<{ repo: string; specs?: Array<{ id: string }> }>;
    };
    const paths: string[] = [];
    for (const repo of data.repos ?? []) {
      for (const spec of repo.specs ?? []) {
        paths.push(`/registry/${repo.repo}/${spec.id}`);
      }
    }
    return paths;
  } catch {
    return [];
  }
}

// The docs stubs (spec 002 §3) are a static content module, so their prerender
// paths come straight from it: one /docs/:slug page per stub, no drift.
function docsPaths(): string[] {
  return DOC_STUBS.map((doc) => `/docs/${doc.slug}`);
}

// The marketing papers (spec 004 §3.4) are a static content module too: one
// /papers/:slug page per paper, enumerated from it so the prerender list cannot
// drift from the corpus.
function paperPaths(): string[] {
  return readerPapers.map((paper) => `/papers/${paper.slug}`);
}

export default {
  ssr: false,
  async prerender() {
    return [
      "/",
      "/products",
      "/papers",
      "/get-started",
      "/registry",
      "/docs",
      ...paperPaths(),
      ...docsPaths(),
      ...registryDetailPaths(),
    ];
  },
} satisfies Config;
