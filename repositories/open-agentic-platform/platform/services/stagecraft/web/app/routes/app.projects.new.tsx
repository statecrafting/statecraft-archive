/**
 * Self-service project creation (spec 080 FR-006 → spec 112 §5.1).
 *
 * Lists factory adapters from the org's `factory_adapters` table and creates
 * the project through the ACP-native `/api/projects/factory-create`
 * endpoint, which writes commit #1 with a `.factory/pipeline-state.json`
 * L0 seed and returns an `opc://` deep link for the success page to
 * hand off to OPC.
 *
 * Gating (spec 112 Phase 5): the loader fetches `/api/projects/scaffold-readiness`
 * alongside the adapter list. If warmup is in progress, no adapter exists,
 * or no upstream PAT is configured, the form renders a banner and disables
 * submit instead of letting the user hit a 500.
 */

import {
  Form,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
} from "react-router";
import { useState } from "react";
import { requireUser } from "../lib/auth.server";
import {
  createFactoryProject,
  listFactoryAdapters,
  getScaffoldReadiness,
  getModuleCatalog,
  type ModuleDescriptor,
  type ProfileDefault,
  type ScaffoldReadiness,
} from "../lib/projects-api.server";
import { applyModuleToggle } from "../lib/module-selection";
import {
  toVariant,
  profileName,
  DEFAULT_AUTH_DRIVER,
  type Auth,
  type AuthDriver,
  type Topology,
} from "../lib/create-project-variant";

// Spec 227 Stage 2: the surface presents two orthogonal axes (FR-002). Auth is
// not independently selectable for `dual` (it serves both stacks); `minimal`
// (mock auth) is deliberately not offered at the OAP surface. The axis-to-wire
// mapping lives in the pure, tested `create-project-variant` helper.

const TOPOLOGY_OPTIONS: Array<{ value: Topology; label: string; description: string }> = [
  { value: "single", label: "Single", description: "One stack (public or internal)." },
  {
    value: "dual",
    label: "Dual",
    description: "Separate public + internal stacks with a BFF boundary.",
  },
];

const AUTH_OPTIONS: Array<{ value: Auth; label: string; description: string }> = [
  { value: "public", label: "Public", description: "Served to citizens / external users." },
  { value: "internal", label: "Internal", description: "Served to staff / internal users." },
];

// Spec 229 auth-driver axis: the app-level AUTH_DRIVER, orthogonal to topology
// and audience. `rauthy` is the production default; `mock` is a zero-dependency
// dev identity. Enterprise IdPs (github/google/auth0/entra/SAML-via-Google-
// Workspace) are Rauthy upstream providers, selected inside Rauthy (later), not
// here.
const AUTH_DRIVER_OPTIONS: Array<{
  value: AuthDriver;
  label: string;
  description: string;
}> = [
  {
    value: "rauthy",
    label: "Rauthy (OIDC)",
    description: "Production identity via Rauthy. Enterprise IdPs federate inside Rauthy.",
  },
  {
    value: "mock",
    label: "Mock (dev)",
    description: "Zero-dependency dev identity; no IdP required. Not for production.",
  },
];

const GATEWAY_TIMEOUT_DEFAULT = "30000";

// Spec 227 Stage 2: the surface splits the catalog into honest regions
// (FR-003/FR-007). Feature modules are the real code modules (category
// "Application"); Infrastructure resources project from the app's baked
// infra.config topology; the gateway (api-gateway) is a base-app config knob +
// the opt-in /connectivity page, not a feature toggle. The catalog + per-profile
// defaults are fetched server-side from GET /api/factory/module-catalog.

interface AdapterSummary {
  id: string;
  name: string;
  version: string;
}

interface LoaderData {
  adapters: AdapterSummary[];
  readiness: ScaffoldReadiness;
  modules: ModuleDescriptor[];
  profiles: ProfileDefault[];
}

interface ActionSuccess {
  projectId: string;
  repoUrl: string;
  cloneUrl: string;
  opcDeepLink: string;
  factoryAdapterId: string;
  devEnvironmentId: string;
  profile: string;
}

interface ActionFailure {
  error: string;
}

type ActionResult = ActionSuccess | ActionFailure;

export async function loader({
  request,
}: {
  request: Request;
}): Promise<LoaderData> {
  await requireUser(request);

  const [adapterListResult, readinessResult, moduleCatalogResult] =
    await Promise.allSettled([
      listFactoryAdapters(request),
      getScaffoldReadiness(request),
      getModuleCatalog(request),
    ]);

  const adapters =
    adapterListResult.status === "fulfilled"
      ? adapterListResult.value.adapters
          .filter((a): a is AdapterSummary & { id: string } => Boolean(a.id))
          .map((a) => ({ id: a.id, name: a.name, version: a.version }))
      : [];

  // Spec 227 Stage 1/2: derived module catalog + per-profile defaults. A
  // rejected/empty result yields an empty picker (the form still renders)
  // rather than a 500.
  const modules =
    moduleCatalogResult.status === "fulfilled"
      ? moduleCatalogResult.value.modules
      : [];
  const profiles =
    moduleCatalogResult.status === "fulfilled"
      ? moduleCatalogResult.value.profiles
      : [];

  const readiness: ScaffoldReadiness =
    readinessResult.status === "fulfilled"
      ? readinessResult.value
      : {
          ready: false,
          step: "error",
          progress: 0,
          hasFactoryAdapter: adapters.length > 0,
          hasUpstreamPat: false,
          scaffoldSourceResolved: false,
          adapters: [],
          canCreate: false,
          blocker: "warmup-error",
          error:
            readinessResult.status === "rejected"
              ? readinessResult.reason instanceof Error
                ? readinessResult.reason.message
                : String(readinessResult.reason)
              : "scaffold-readiness lookup failed",
        };

  return { adapters, readiness, modules, profiles };
}

export async function action({
  request,
}: {
  request: Request;
}): Promise<ActionResult> {
  const user = await requireUser(request);
  const formData = await request.formData();

  const name = (formData.get("name") as string | null) ?? "";
  const slug = (formData.get("slug") as string | null) ?? "";
  const description = (formData.get("description") as string | null) ?? "";
  const adapterId = (formData.get("adapterId") as string | null) ?? "";
  const topology = ((formData.get("topology") as string | null) ??
    "single") as Topology;
  const authAxis = ((formData.get("auth") as string | null) ??
    "public") as Auth;
  const variant = toVariant(topology, authAxis);
  const authDriver = ((formData.get("authDriver") as string | null) ??
    DEFAULT_AUTH_DRIVER) as AuthDriver;
  const repoName = (formData.get("repoName") as string | null) ?? "";
  const isPrivate = formData.get("visibility") !== "public";
  const modules = formData.getAll("modules").map(String);
  const bffPrivateApiBaseUrl = (
    (formData.get("bffPrivateApiBaseUrl") as string | null) ?? ""
  ).trim();
  const gatewayTimeoutRaw = (
    (formData.get("gatewayTimeoutMs") as string | null) ?? ""
  ).trim();

  if (!name || !slug || !adapterId || !repoName) {
    return { error: "Name, slug, adapter, and repository name are required." };
  }
  if (slug.length < 3 || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) {
    return {
      error:
        "Slug must be at least 3 characters, lowercase alphanumeric with hyphens (e.g., my-project).",
    };
  }
  if (gatewayTimeoutRaw && !/^[1-9][0-9]*$/.test(gatewayTimeoutRaw)) {
    return {
      error: "Gateway timeout must be a positive whole number of milliseconds.",
    };
  }

  try {
    const result = await createFactoryProject(request, {
      name,
      slug,
      description: description || undefined,
      adapterId,
      variant,
      modules: variant === "dual" ? [] : modules,
      repoName,
      isPrivate,
      bffPrivateApiBaseUrl: bffPrivateApiBaseUrl || undefined,
      gatewayTimeoutMs: gatewayTimeoutRaw ? Number(gatewayTimeoutRaw) : undefined,
      authDriver,
    });
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("createFactoryProject failed", {
      userId: user.userId,
      orgSlug: user.orgSlug,
      slug,
      repoName,
      adapterId,
      error: msg,
    });
    let backendMsg = msg;
    try {
      const parsed = JSON.parse(msg) as { message?: string };
      if (parsed.message) backendMsg = parsed.message;
    } catch {
      /* leave msg alone */
    }
    return { error: backendMsg };
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function isSuccess(data: ActionResult | undefined): data is ActionSuccess {
  return Boolean(data && (data as ActionSuccess).projectId);
}

export default function NewProject() {
  const { adapters, readiness, modules, profiles } =
    useLoaderData() as LoaderData;
  const actionData = useActionData() as ActionResult | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [repoName, setRepoName] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [repoEdited, setRepoEdited] = useState(false);
  const [topology, setTopology] = useState<Topology>("single");
  const [auth, setAuth] = useState<Auth>("public");
  const [authDriver, setAuthDriver] = useState<AuthDriver>(DEFAULT_AUTH_DRIVER);
  const [selectedModules, setSelectedModules] = useState<Set<string>>(
    () => new Set()
  );
  const [connectivity, setConnectivity] = useState(false);
  const [privateApiBaseUrl, setPrivateApiBaseUrl] = useState("");
  const [gatewayTimeout, setGatewayTimeout] = useState(GATEWAY_TIMEOUT_DEFAULT);
  // Spec 227 Stage 4 (FR-004): opt-in Redis infrastructure. Selecting it adds
  // the factory data-redis module to the composed set, which bakes a `redis`
  // block into the scaffolded apps/api/infra.config.json. Offered for single
  // topology only; dual module composition is a later factory increment
  // (factory-encore spec 008 FR-003), so the picker (and this row) stay
  // single-only to avoid a silent dual no-op (mirrors the feature-module gate).
  const [redis, setRedis] = useState(false);

  // Spec 227 Stage 2 sectioning: feature modules are the real code modules
  // (category "Application"); the gateway (api-gateway) is a base-app knob, not
  // a feature toggle. The internal profile auto-ships its modules ("auto for
  // Internal"), surfaced pre-checked and read-only.
  const featureModules = modules.filter((m) => m.category === "Application");
  const gatewayModule = modules.find((m) => m.id === "api-gateway");
  const currentProfile = profileName(topology, auth);
  const autoModules = new Set(
    profiles.find((p) => p.name === currentProfile)?.modules ?? []
  );

  // Spec 227 cron stage: a selected feature module can transitively require an
  // infra module that is not itself a rendered feature checkbox (cron ->
  // data-postgres). `applyModuleToggle` pulls those into `selectedModules`, but
  // only rendered, enabled feature checkboxes submit their value, so the infra
  // requires would be dropped and the generator would reject the cron install
  // (its `requires: ["data-postgres"]` unmet). Emit them as hidden inputs so the
  // scaffold receives the full requires closure and composes data-postgres first
  // (the same closure-as-hidden-inputs pattern the /connectivity gateway uses).
  const featureIds = new Set(featureModules.map((m) => m.id));
  const infraRequires = [...selectedModules].filter((id) => !featureIds.has(id));

  const handleNameChange = (value: string) => {
    setName(value);
    const derived = slugify(value);
    if (!slugEdited) setSlug(derived);
    if (!repoEdited) setRepoName(slugEdited ? slug : derived);
  };

  const toggleModule = (id: string, checked: boolean) => {
    // Transitive dependency resolution lives in a pure, tested helper (spec 227).
    setSelectedModules((prev) => applyModuleToggle(modules, prev, id, checked));
  };

  if (isSuccess(actionData)) {
    return <CreateSuccess data={actionData} />;
  }

  const banner = renderReadinessBanner(readiness);
  const submitDisabled = isSubmitting || !readiness.canCreate;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Create New Project
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Scaffold a new project with a factory adapter, GitHub repo, and a
          pre-seeded factory pipeline state.
        </p>
      </div>

      {banner}

      {actionData && !isSuccess(actionData) && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3">
          <p className="text-sm text-red-700 dark:text-red-400">
            {(actionData as ActionFailure).error}
          </p>
        </div>
      )}

      {readiness.canCreate && adapters.length > 0 && (
        <Form method="post" className="space-y-5">
          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Project Name
            </label>
            <input
              type="text"
              name="name"
              id="name"
              required
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              placeholder="My Project"
            />
          </div>

          <div>
            <label
              htmlFor="slug"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Slug
            </label>
            <input
              type="text"
              name="slug"
              id="slug"
              required
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugEdited(true);
                if (!repoEdited) setRepoName(e.target.value);
              }}
              className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 font-mono focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              placeholder="my-project"
              pattern="[a-z0-9][a-z0-9-]*[a-z0-9]"
            />
          </div>

          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Description
            </label>
            <textarea
              name="description"
              id="description"
              rows={2}
              className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              placeholder="Brief project description"
            />
          </div>

          <div>
            <label
              htmlFor="adapterId"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Factory Adapter
            </label>
            <select
              name="adapterId"
              id="adapterId"
              required
              defaultValue={adapters[0].id}
              className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            >
              {adapters.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} @ {a.version}
                </option>
              ))}
            </select>
          </div>

          {/* Spec 227 Stage 2 (FR-002): two orthogonal axes. Auth is fixed for
              dual (it serves both stacks). */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <fieldset>
              <legend className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Topology
              </legend>
              <div className="space-y-2">
                {TOPOLOGY_OPTIONS.map((t) => (
                  <label
                    key={t.value}
                    className="relative flex items-start border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 cursor-pointer hover:border-indigo-500 has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50 dark:has-[:checked]:bg-indigo-900/20"
                  >
                    <input
                      type="radio"
                      name="topology"
                      value={t.value}
                      checked={topology === t.value}
                      onChange={() => setTopology(t.value)}
                      className="mt-0.5 h-4 w-4 text-indigo-600 border-gray-300"
                    />
                    <div className="ml-3">
                      <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">
                        {t.label}
                      </span>
                      <span className="block text-xs text-gray-500 dark:text-gray-400">
                        {t.description}
                      </span>
                    </div>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset
              disabled={topology === "dual"}
              className="disabled:opacity-50"
            >
              <legend className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Audience
              </legend>
              <div className="space-y-2">
                {AUTH_OPTIONS.map((a) => (
                  <label
                    key={a.value}
                    className="relative flex items-start border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 cursor-pointer has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50 dark:has-[:checked]:bg-indigo-900/20 has-[:disabled]:cursor-not-allowed"
                  >
                    <input
                      type="radio"
                      name="auth"
                      value={a.value}
                      checked={auth === a.value}
                      onChange={() => setAuth(a.value)}
                      className="mt-0.5 h-4 w-4 text-indigo-600 border-gray-300"
                    />
                    <div className="ml-3">
                      <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">
                        {a.label}
                      </span>
                      <span className="block text-xs text-gray-500 dark:text-gray-400">
                        {a.description}
                      </span>
                    </div>
                  </label>
                ))}
              </div>
              {topology === "dual" && (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Dual serves both public and internal stacks.
                </p>
              )}
            </fieldset>
          </div>

          {/* Spec 229 auth-driver axis: the app-level AUTH_DRIVER (mock|rauthy),
              orthogonal to topology and audience. */}
          <fieldset>
            <legend className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Auth
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {AUTH_DRIVER_OPTIONS.map((d) => (
                <label
                  key={d.value}
                  className="relative flex items-start border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 cursor-pointer hover:border-indigo-500 has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50 dark:has-[:checked]:bg-indigo-900/20"
                >
                  <input
                    type="radio"
                    name="authDriver"
                    value={d.value}
                    checked={authDriver === d.value}
                    onChange={() => setAuthDriver(d.value)}
                    className="mt-0.5 h-4 w-4 text-indigo-600 border-gray-300"
                  />
                  <div className="ml-3">
                    <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">
                      {d.label}
                    </span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">
                      {d.description}
                    </span>
                  </div>
                </label>
              ))}
            </div>
          </fieldset>

          {/* Spec 227 Stage 2 (FR-003): Infrastructure is a read-only projection
              of the baked infra.config topology. */}
          <fieldset className="rounded-md border border-gray-200 dark:border-gray-700 px-4 py-3">
            <legend className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 px-1">
              Infrastructure
            </legend>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
              Projected read-only from the baked{" "}
              <code>apps/api/infra.config.json</code> topology; identical across
              environments (dev provisioned by OAP).
            </p>
            <div className="space-y-2">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked
                  disabled
                  readOnly
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600"
                />
                <span>
                  <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">
                    PostgreSQL
                  </span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">
                    Default-on. The baseline database (sql_servers).
                  </span>
                </span>
              </div>
              {topology === "dual" ? (
                <div className="flex items-start gap-3 opacity-60">
                  <input
                    type="checkbox"
                    disabled
                    className="mt-0.5 h-4 w-4 rounded border-gray-300"
                  />
                  <span>
                    <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">
                      Redis / cache
                      <span className="ml-2 rounded bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        Single only
                      </span>
                    </span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">
                      Redis is available for single-topology projects; dual
                      module composition is a later factory increment.
                    </span>
                  </span>
                </div>
              ) : (
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    name="modules"
                    value="data-redis"
                    checked={redis}
                    onChange={(e) => setRedis(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600"
                  />
                  <span>
                    <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">
                      Redis / cache
                    </span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">
                      Opt-in. Bakes a <code>redis</code> block into the app&apos;s{" "}
                      <code>infra.config.json</code> (REDIS_HOST / REDIS_USER /
                      REDIS_PASSWORD); OAP provisions a dev instance. Consumed by
                      the cron large-scale lock. Not a rate-limit backend (that is
                      Postgres).
                    </span>
                  </span>
                </label>
              )}
            </div>
          </fieldset>

          {/* Spec 227 Stage 2 (FR-008): feature modules, single topology only.
              Dual composes no feature modules today, so the picker is hidden. */}
          {topology !== "dual" && featureModules.length > 0 && (
            <fieldset className="rounded-md border border-gray-200 dark:border-gray-700 px-4 py-3">
              <legend className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 px-1">
                Application features
              </legend>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                Real code modules composed into the scaffold. Dependencies are
                resolved automatically.
              </p>
              <div className="space-y-2">
                {featureModules.map((m) => {
                  const isAuto = autoModules.has(m.id);
                  const checked = isAuto || selectedModules.has(m.id);
                  return (
                    <label
                      key={m.id}
                      className="flex items-start gap-3 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        name="modules"
                        value={m.id}
                        checked={checked}
                        disabled={isAuto}
                        onChange={(e) => toggleModule(m.id, e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-60"
                      />
                      <span>
                        <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">
                          {m.displayName}
                          {isAuto && (
                            <span className="ml-2 text-xs font-normal text-indigo-600 dark:text-indigo-400">
                              auto for Internal
                            </span>
                          )}
                        </span>
                        <span className="block text-xs text-gray-500 dark:text-gray-400">
                          {m.description}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              {/* Spec 227 cron stage: submit the transitive infra requires
                  (e.g. cron -> data-postgres) that are not rendered feature
                  checkboxes, so the scaffold composes them ahead of the feature. */}
              {infraRequires.map((id) => (
                <input key={id} type="hidden" name="modules" value={id} />
              ))}
            </fieldset>
          )}

          {/* Spec 227 Stage 2 (FR-007): base-app knobs as fields, not toggles;
              security posture is always on. CORS omitted until factory-encore
              008 wires it. */}
          <fieldset className="rounded-md border border-gray-200 dark:border-gray-700 px-4 py-3 space-y-3">
            <legend className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 px-1">
              Base-app config
            </legend>
            <div>
              <label
                htmlFor="bffPrivateApiBaseUrl"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                BFF private-backend URL
              </label>
              <input
                type="text"
                name="bffPrivateApiBaseUrl"
                id="bffPrivateApiBaseUrl"
                value={privateApiBaseUrl}
                onChange={(e) => setPrivateApiBaseUrl(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm font-mono text-gray-900 dark:text-gray-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                placeholder="blank uses the template default"
              />
            </div>
            <div>
              <label
                htmlFor="gatewayTimeoutMs"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Gateway timeout (ms)
              </label>
              <input
                type="number"
                min={1}
                name="gatewayTimeoutMs"
                id="gatewayTimeoutMs"
                value={gatewayTimeout}
                onChange={(e) => setGatewayTimeout(e.target.value)}
                className="mt-1 block w-40 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm font-mono text-gray-900 dark:text-gray-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            {/* The /connectivity page IS the api-gateway module. Only offer it
                where it can be honored: single topology with the gateway module
                in the catalog (dual composes no feature modules). */}
            {topology !== "dual" && gatewayModule && (
              <>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={connectivity}
                    onChange={(e) => setConnectivity(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>
                    <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">
                      /connectivity diagnostic page
                    </span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">
                      Adds a dev-only page that probes the gateway to the private
                      backend.
                    </span>
                  </span>
                </label>
                {connectivity &&
                  [
                    ...applyModuleToggle(
                      modules,
                      new Set<string>(),
                      gatewayModule.id,
                      true
                    ),
                  ].map((id) => (
                    <input key={id} type="hidden" name="modules" value={id} />
                  ))}
              </>
            )}
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Security posture (CSP/HSTS, rate limiting, structured logging) is
              always on.
            </p>
          </fieldset>

          <div>
            <label
              htmlFor="repoName"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Repository Name
            </label>
            <input
              type="text"
              name="repoName"
              id="repoName"
              required
              value={repoName}
              onChange={(e) => {
                setRepoName(e.target.value);
                setRepoEdited(true);
              }}
              className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 font-mono focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              placeholder="my-project"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Visibility
            </label>
            <div className="flex gap-4">
              <label className="flex items-center">
                <input
                  type="radio"
                  name="visibility"
                  value="private"
                  defaultChecked
                  className="h-4 w-4 text-indigo-600 border-gray-300"
                />
                <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                  Private
                </span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  name="visibility"
                  value="public"
                  className="h-4 w-4 text-indigo-600 border-gray-300"
                />
                <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                  Public
                </span>
              </label>
            </div>
          </div>

          <div className="flex items-center gap-4 pt-2">
            <button
              type="submit"
              disabled={submitDisabled}
              className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? "Creating..." : "Create Project"}
            </button>
            <a
              href="/app"
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            >
              Cancel
            </a>
          </div>
        </Form>
      )}
    </div>
  );
}

function renderReadinessBanner(readiness: ScaffoldReadiness): React.ReactNode {
  switch (readiness.blocker) {
    case "no-factory-adapter":
      return (
        <div className="rounded-md bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 px-4 py-3">
          <p className="text-sm text-yellow-900 dark:text-yellow-200">
            <strong>No factory adapters available.</strong> Visit{" "}
            <a href="/app/factory" className="underline font-medium">
              /app/factory
            </a>{" "}
            and run a sync to populate this org's adapter catalog before
            creating projects.
          </p>
        </div>
      );
    case "stale-adapter-manifest":
      return (
        <div className="rounded-md bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 px-4 py-3">
          <p className="text-sm text-yellow-900 dark:text-yellow-200">
            <strong>Adapter manifest needs refreshing.</strong> Your
            existing factory adapter rows predate the spec 139 translator
            change and lack the <code>scaffold_source_id</code> field the
            scaffold layer needs. Visit{" "}
            <a href="/app/factory" className="underline font-medium">
              /app/factory
            </a>{" "}
            and trigger a sync — once it completes the warmup will start
            automatically and the form will unlock.
          </p>
        </div>
      );
    case "no-upstream-pat":
      return (
        <div className="rounded-md bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 px-4 py-3">
          <p className="text-sm text-yellow-900 dark:text-yellow-200">
            <strong>No factory upstream PAT configured.</strong> Add a PAT at{" "}
            <a
              href="/app/admin/factory/pat"
              className="underline font-medium"
            >
              /app/admin/factory/pat
            </a>{" "}
            so statecraft can clone the template repo on your behalf.
          </p>
        </div>
      );
    case "no-scaffold-source-resolved": {
      // Spec 139 Phase 2 (T056/T057). Surface the per-adapter verdict so
      // the user knows which adapter is missing its `scaffold_source_id`
      // upstream and what to register.
      const offenders = readiness.adapters.filter(
        (a) => a.declaresScaffoldSource && !a.scaffoldSourceResolved,
      );
      return (
        <div className="rounded-md bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 px-4 py-3">
          <p className="text-sm text-yellow-900 dark:text-yellow-200">
            <strong>Scaffold source not resolved.</strong> One or more
            adapters declare a <code>scaffold_source_id</code> that does
            not match any registered upstream in this org. Visit{" "}
            <a
              href="/app/factory/upstreams"
              className="underline font-medium"
            >
              /app/factory/upstreams
            </a>{" "}
            and register the source ids below.
          </p>
          {offenders.length > 0 ? (
            <ul className="mt-2 list-disc pl-5 text-sm text-yellow-900 dark:text-yellow-200">
              {offenders.map((a) => (
                <li key={a.id}>
                  <code>{a.name}</code> — needs scaffold source registered
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      );
    }
    case "warmup-error":
      return (
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3">
          <p className="text-sm text-red-700 dark:text-red-400">
            <strong>Scaffold infrastructure error:</strong>{" "}
            {readiness.error ?? "Warmup failed; check statecraft logs."}
          </p>
        </div>
      );
    case "warming-up":
      return (
        <div className="rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-4 py-3">
          <p className="text-sm text-blue-700 dark:text-blue-300">
            <strong>Warming up scaffold cache</strong> — step:{" "}
            <code>{readiness.step}</code> ({readiness.progress}%). The form will
            unlock once the four prebuilds are ready (~2-3 min after deploy).
          </p>
        </div>
      );
    default:
      return null;
  }
}

function CreateSuccess({ data }: { data: ActionSuccess }) {
  // The deploy trigger posts to the env detail route's action, whose result
  // shape is { ok, intent?, error? }.
  const deployFetcher = useFetcher<{
    ok: boolean;
    intent?: string;
    error?: string;
  }>();
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-4 py-3">
        <p className="text-sm text-green-800 dark:text-green-300">
          Project created. Your GitHub repo now holds commit #1 with a seeded{" "}
          <code>.factory/pipeline-state.json</code> and the{" "}
          <code>{data.profile}</code> profile tree.
        </p>
      </div>
      <dl className="rounded-md border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
        <div className="grid grid-cols-[12rem_1fr] px-4 py-3">
          <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
            GitHub repo
          </dt>
          <dd className="text-sm text-indigo-600 dark:text-indigo-400">
            <a href={data.repoUrl} target="_blank" rel="noreferrer">
              {data.repoUrl}
            </a>
          </dd>
        </div>
        <div className="grid grid-cols-[12rem_1fr] px-4 py-3">
          <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
            Clone URL
          </dt>
          <dd className="text-sm font-mono text-gray-900 dark:text-gray-100 break-all">
            {data.cloneUrl}
          </dd>
        </div>
        <div className="grid grid-cols-[12rem_1fr] px-4 py-3">
          <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
            Open in OPC
          </dt>
          <dd>
            <a
              href={data.opcDeepLink}
              className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Launch Factory Cockpit
            </a>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 font-mono break-all">
              {data.opcDeepLink}
            </p>
          </dd>
        </div>
        {/* Spec 215 FR-001: post-create deploy accelerator. */}
        <div className="grid grid-cols-[12rem_1fr] px-4 py-3">
          <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
            Preview in Deployd
          </dt>
          <dd className="space-y-1">
            <div className="flex items-center gap-3">
              <deployFetcher.Form
                method="post"
                action={`/app/project/${data.projectId}/deploys/${data.devEnvironmentId}`}
              >
                <input type="hidden" name="intent" value="deploy.trigger" />
                <button
                  type="submit"
                  disabled={deployFetcher.state !== "idle"}
                  className="inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {deployFetcher.state !== "idle"
                    ? "Deploying..."
                    : "Preview in Deployd"}
                </button>
              </deployFetcher.Form>
              <a
                href={`/app/project/${data.projectId}/deploys/${data.devEnvironmentId}`}
                className="text-sm text-indigo-600 dark:text-indigo-400"
              >
                View Deployd →
              </a>
            </div>
            {deployFetcher.data && deployFetcher.data.ok === false && (
              <p className="text-xs text-red-600 dark:text-red-400">
                {deployFetcher.data.error}
              </p>
            )}
            {deployFetcher.data && deployFetcher.data.ok === true && (
              <p className="text-xs text-green-600 dark:text-green-400">
                Deploy triggered. Open View Deployd for live status.
              </p>
            )}
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Deploys the latest built image to the development environment.
              While the image is still building you will see "image not built
              yet"; retry once the build finishes.
            </p>
          </dd>
        </div>
      </dl>
      <div>
        <a
          href={`/app/project/${data.projectId}`}
          className="text-sm text-indigo-600 dark:text-indigo-400"
        >
          Go to project dashboard →
        </a>
      </div>
    </div>
  );
}
