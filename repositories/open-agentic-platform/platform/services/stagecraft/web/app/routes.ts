import {
  type RouteConfig,
  index,
  layout,
  route,
} from "@react-router/dev/routes";

export default [
  // Public marketing surface. The pathless `marketing` layout supplies the
  // shared header + footer; sign-in / app / admin sit outside it.
  layout("routes/marketing.tsx", [
    index("routes/_index.tsx"),
    route("products", "routes/products.tsx"),
    route("papers", "routes/papers.tsx"),
    route("papers/:slug", "routes/papers.$slug.tsx"),
    route("registry", "routes/registry.tsx", [
      index("routes/registry._index.tsx"),
      route("graph", "routes/registry.graph.tsx"),
      route("dashboard", "routes/registry.dashboard.tsx"),
    ]),
    route("registry/:specId", "routes/registry.$specId.tsx"),
    route("get-started", "routes/get-started.tsx"),
  ]),
  route("signin", "routes/signin.tsx"),
  route("signup", "routes/signup.tsx"),
  route("auth/no-org", "routes/auth.no-org.tsx"),
  route("auth/org-select", "routes/auth.org-select.tsx"),
  route("admin/signin", "routes/admin.signin.tsx"),
  route("app", "routes/app.tsx", [
    index("routes/app._index.tsx"),
    // Spec 123 — org-level Agents top-nav surface (Phase 4)
    route("agents", "routes/app.agents.tsx", [
      index("routes/app.agents._index.tsx"),
      route("new", "routes/app.agents.new.tsx"),
      route(":agentId", "routes/app.agents.$agentId.tsx"),
      route(":agentId/publish", "routes/app.agents.$agentId.publish.tsx"),
      route(":agentId/history", "routes/app.agents.$agentId.history.tsx"),
    ]),
    route("factory", "routes/app.factory.tsx", [
      index("routes/app.factory._index.tsx"),
      route("upstreams", "routes/app.factory.upstreams.tsx"),
      // Spec 124 §7 — Runs tab + run-detail.
      route("runs", "routes/app.factory.runs._index.tsx"),
      route("runs/:runId", "routes/app.factory.runs.$runId.tsx"),
      route("adapters", "routes/app.factory.adapters.tsx"),
      route("contracts", "routes/app.factory.contracts.tsx"),
      route("processes", "routes/app.factory.processes.tsx"),
    ]),
    route("projects/new", "routes/app.projects.new.tsx"),
    route("projects/import", "routes/app.projects.import.tsx"),
    // Spec 113 — resource routes for the Clone Project dialog. The dialog
    // runs in the browser so it cannot call Encore directly (cookies don't
    // forward); these routes proxy through the SSR layer where
    // `apiFetch` injects the user's session cookie.
    route(
      "projects/clone-availability",
      "routes/app.projects.clone-availability.tsx"
    ),
    route(
      "projects/:sourceProjectId/clone",
      "routes/app.projects.$sourceProjectId.clone.tsx"
    ),
    route(
      "projects/clone-runs/:cloneJobId",
      "routes/app.projects.clone-runs.$cloneJobId.tsx"
    ),
    route("project/:projectId", "routes/app.project.$projectId.tsx", [
      index("routes/app.project.$projectId._index.tsx"),
      route("knowledge", "routes/app.project.$projectId.knowledge.tsx"),
      route("knowledge/:id", "routes/app.project.$projectId.knowledge.$id.tsx"),
      // Spec 163 — Requirements view (read-shaped spec-spine surface).
      route(
        "requirements",
        "routes/app.project.$projectId.requirements.tsx"
      ),
      route(
        "requirements/:specId",
        "routes/app.project.$projectId.requirements.$specId.tsx"
      ),
      // Spec 123 Phase 5 — project Agents tab is now a binding manager;
      // 119-era authoring routes (new, :agentId, :agentId/publish,
      // :agentId/history) are deleted. Authoring lives at /app/agents.
      route("agents", "routes/app.project.$projectId.agents.tsx", [
        index("routes/app.project.$projectId.agents._index.tsx"),
      ]),
      // Spec 164 — Pipelines → Development rename. The new home is the
      // lifecycle-state board; the legacy URL is preserved by a 308
      // redirect for one release cycle (spec 164 §2.1 / FR-002).
      route(
        "development",
        "routes/app.project.$projectId.development.tsx"
      ),
      route("pipelines", "routes/app.project.$projectId.pipelines.tsx"),
      route("deploys", "routes/app.project.$projectId.deploys.tsx"),
      // Spec 215: env-detail page (deployment card + trigger, FR-004/FR-006;
      // also spec 137's access-gate UI). The detail file existed since 137 but
      // was never registered here, so /deploys/:envId 404'd. Sibling of the
      // list (deploys.tsx is a leaf, no Outlet).
      route(
        "deploys/:envId",
        "routes/app.project.$projectId.deploys.$envId.tsx",
      ),
      route("settings", "routes/app.project.$projectId.settings.tsx", [
        index("routes/app.project.$projectId.settings._index.tsx"),
        route("repos", "routes/app.project.$projectId.settings.repos.tsx"),
        route("connectors", "routes/app.project.$projectId.settings.connectors.tsx"),
        route("connectors/new", "routes/app.project.$projectId.settings.connectors.new.tsx"),
        route("connectors/:id", "routes/app.project.$projectId.settings.connectors.$id.tsx"),
        route("github-pat", "routes/app.project.$projectId.settings.github-pat.tsx"),
      ]),
    ]),
  ]),
  route("admin", "routes/admin.tsx", [
    index("routes/admin._index.tsx"),
    route("users", "routes/admin.users.tsx"),
    route("audit", "routes/admin.audit.tsx"),
    route("sessions", "routes/admin.sessions.tsx"),
    route("oidc-providers", "routes/admin.oidc-providers.tsx"),
    route("projects", "routes/admin.projects.tsx", [
      index("routes/admin.projects._index.tsx"),
      route("new", "routes/admin.projects.new.tsx"),
      route(":id", "routes/admin.projects.$id.tsx"),
    ]),
  ]),
] satisfies RouteConfig;
