import {
  type RouteConfig,
  index,
  layout,
  route,
} from "@react-router/dev/routes";

// Static site. Everything lives under the shared site layout (header + footer).
// `ssr: false` (react-router.config.ts) prerenders each of these to HTML; the
// dynamic registry detail route is enumerated for prerender from the baked
// payload.
export default [
  layout("layouts/site.tsx", [
    index("routes/_index.tsx"),
    // Rich marketing surfaces (spec 004): products, papers + whitepaper reader,
    // get-started. Extends the spec-001 route table without disturbing it.
    route("products", "routes/products.tsx"),
    route("papers", "routes/papers.tsx"),
    route("papers/:slug", "routes/papers.$slug.tsx"),
    route("get-started", "routes/get-started.tsx"),
    route("registry", "routes/registry.tsx"),
    route("registry/:repo/:specId", "routes/registry.$repo.$specId.tsx"),
    route("docs", "routes/docs.tsx"),
    route("docs/:slug", "routes/docs.$slug.tsx"),
  ]),
] satisfies RouteConfig;
