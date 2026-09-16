// Spec 137 Phase 5 — per-environment access-gate management UI.
//
// Routes:
//   GET  /app/project/:projectId/deploys/:envId
//   POST /app/project/:projectId/deploys/:envId  (action with `intent`)
//
// The page renders one card (the "Access gate" card from T050) with three
// sub-sections — descriptor toggle + login-method picker (T050/T052),
// allowlist editor (T051), and a small live-preview hint (T053). T054's
// empty-state UX is the gate.enabled=false rendering: a single explanatory
// paragraph + "Enable gate" CTA.
//
// All mutations route through the `action` handler. Three intents:
//   * `gate.save`       — PUT  /api/environments/:envId/access-gate
//   * `allowlist.add`   — POST .../allowlist
//   * `allowlist.remove`— DELETE .../allowlist/:entryId
//
// Org-permission gating happens server-side in the Phase 2 API; the UI
// degrades gracefully (errors surface inline) if a viewer-role user lands
// on this page.

import { Form, useLoaderData, useFetcher, Link, redirect } from "react-router";
import { requireUser } from "../lib/auth.server";
import { listEnvironments } from "../lib/projects-api.server";
import {
  addAllowlistEntry,
  createDeployment,
  getAccessGate,
  getLatestDeployment,
  putAccessGate,
  removeAllowlistEntry,
  type AccessGateAllowlistEntry,
  type AccessGateRead,
  type DeploymentView,
  type FederatedProvider,
} from "../lib/projects-api.server";

type LoaderData = {
  projectId: string;
  envId: string;
  envName: string;
  envKind: string;
  k8sNamespace: string | null;
  gate: AccessGateRead;
  deployment: DeploymentView | null;
};

type ActionData =
  | { ok: true; intent: string }
  | { ok: false; intent: string; error: string };

export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { projectId: string; envId: string };
}): Promise<LoaderData> {
  await requireUser(request);

  // Resolve the env row to confirm it belongs to this project and surface
  // its display fields. listEnvironments returns the whole project's set;
  // for a single env we'd ideally have a focused endpoint, but Phase 2
  // didn't ship one and adding it for the UI is scope creep. Filter here.
  const envRes = await listEnvironments(request, params.projectId);
  const env = (envRes.environments as Array<{
    id: string;
    name: string;
    kind: string;
    k8sNamespace: string | null;
  }>).find((e) => e.id === params.envId);
  if (!env) {
    throw new Response("Environment not found in this project", {
      status: 404,
    });
  }

  const gate = await getAccessGate(request, params.envId);
  // FR-004/008: latest deployment (null = never deployed). The endpoint lazily
  // reconciles a stale PENDING record against deployd-api before answering.
  const { deployment } = await getLatestDeployment(
    request,
    params.projectId,
    params.envId,
  );

  return {
    projectId: params.projectId,
    envId: params.envId,
    envName: env.name,
    envKind: env.kind,
    k8sNamespace: env.k8sNamespace,
    gate,
    deployment,
  };
}

export async function action({
  request,
  params,
}: {
  request: Request;
  params: { projectId: string; envId: string };
}): Promise<ActionData | Response> {
  await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    if (intent === "gate.save") {
      const enabled = form.get("enabled") === "true";
      const loginMethodMagicLink = form.get("loginMethodMagicLink") === "true";
      const fedRaw = String(form.get("loginMethodFederatedProvider") ?? "");
      const fedRefRaw = String(
        form.get("loginMethodFederatedProviderClientRef") ?? "",
      );
      const loginMethodFederatedProvider: FederatedProvider | null =
        fedRaw === "google" ||
        fedRaw === "microsoft" ||
        fedRaw === "github" ||
        fedRaw === "generic_oidc"
          ? fedRaw
          : null;
      const loginMethodFederatedProviderClientRef =
        loginMethodFederatedProvider && fedRefRaw.length > 0
          ? fedRefRaw
          : null;

      await putAccessGate(request, params.envId, {
        enabled,
        loginMethodMagicLink,
        loginMethodFederatedProvider,
        loginMethodFederatedProviderClientRef,
      });
      return { ok: true, intent };
    }

    if (intent === "allowlist.add") {
      const kindRaw = String(form.get("kind") ?? "");
      const value = String(form.get("value") ?? "").trim();
      if (kindRaw !== "email" && kindRaw !== "domain") {
        return { ok: false, intent, error: "kind must be email or domain" };
      }
      if (value.length === 0) {
        return { ok: false, intent, error: "value is required" };
      }
      await addAllowlistEntry(request, params.envId, {
        kind: kindRaw,
        value,
      });
      return { ok: true, intent };
    }

    if (intent === "allowlist.remove") {
      const entryId = String(form.get("entryId") ?? "");
      if (entryId.length === 0) {
        return { ok: false, intent, error: "entryId is required" };
      }
      await removeAllowlistEntry(request, params.envId, entryId);
      return { ok: true, intent };
    }

    if (intent === "deploy.trigger") {
      // FR-001/002: trigger a deploy of the project's latest built image.
      // A not-built / approval-required / transport error throws in the
      // client (apiFetch); the catch below surfaces it inline as the reason.
      await createDeployment(request, params.projectId, params.envId);
      return { ok: true, intent };
    }

    return { ok: false, intent, error: `unknown intent: ${intent}` };
  } catch (e) {
    return {
      ok: false,
      intent,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const ENV_KIND_COLORS: Record<string, string> = {
  preview:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  development:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  staging:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  production:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

const DEPLOY_STATUS_COLORS: Record<string, string> = {
  REQUESTED: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  PENDING:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  ROLLED_OUT:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  FAILED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  REQUEST_FAILED:
    "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  DESTROYED: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

export default function EnvironmentDetail() {
  const { projectId, envId, envName, envKind, k8sNamespace, gate, deployment } =
    useLoaderData<LoaderData>();
  const gateFetcher = useFetcher();
  const allowlistFetcher = useFetcher();
  const deployFetcher = useFetcher<ActionData>();

  // Optimistic enabled state: if the user just submitted gate.save, render
  // the value they're submitting rather than the stale loader data, so the
  // toggle's affordances (Login methods section visibility, allowlist
  // editability) line up with what the server is being told.
  const submittedEnabled =
    gateFetcher.formData?.get("intent") === "gate.save"
      ? gateFetcher.formData?.get("enabled") === "true"
      : null;
  const enabled = submittedEnabled ?? gate.enabled;

  return (
    <div className="space-y-6 max-w-3xl">
      <header className="space-y-2">
        <Link
          to={`/app/project/${projectId}/deploys`}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          ← All environments
        </Link>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          {envName}
          <span
            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
              ENV_KIND_COLORS[envKind] ?? "bg-gray-100 text-gray-800"
            }`}
          >
            {envKind}
          </span>
        </h2>
        {k8sNamespace && (
          <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">
            namespace: {k8sNamespace}
          </p>
        )}
      </header>

      {/* Spec 215 FR-004: deployment state + trigger. */}
      <section
        className="rounded-lg border border-gray-200 dark:border-gray-800 p-5 space-y-4"
        aria-labelledby="deployment-heading"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 id="deployment-heading" className="text-base font-semibold">
              Deployment
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Deploy this project's latest built image to {envName}.
            </p>
          </div>
          <deployFetcher.Form method="post">
            <input type="hidden" name="intent" value="deploy.trigger" />
            <button
              type="submit"
              disabled={deployFetcher.state !== "idle"}
              className="inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {deployFetcher.state !== "idle"
                ? "Deploying..."
                : deployment
                  ? "Redeploy"
                  : "Preview in Deployd"}
            </button>
          </deployFetcher.Form>
        </div>

        {deployFetcher.data &&
          deployFetcher.data.ok === false &&
          deployFetcher.data.intent === "deploy.trigger" && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {deployFetcher.data.error}
            </p>
          )}

        {!deployment ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Never deployed.
          </p>
        ) : (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-gray-500 dark:text-gray-400">Status</dt>
            <dd>
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  DEPLOY_STATUS_COLORS[deployment.status] ??
                  "bg-gray-100 text-gray-800"
                }`}
              >
                {deployment.status}
              </span>
            </dd>

            <dt className="text-gray-500 dark:text-gray-400">Commit</dt>
            <dd className="font-mono text-xs">{deployment.releaseSha}</dd>

            <dt className="text-gray-500 dark:text-gray-400">Image</dt>
            <dd className="font-mono text-xs break-all">
              {deployment.artifactRef}
            </dd>

            <dt className="text-gray-500 dark:text-gray-400">By</dt>
            <dd>{deployment.dispatchedBy}</dd>

            <dt className="text-gray-500 dark:text-gray-400">Updated</dt>
            <dd>{new Date(deployment.updatedAt).toLocaleString()}</dd>

            {deployment.endpoints.length > 0 && (
              <>
                <dt className="text-gray-500 dark:text-gray-400">URLs</dt>
                <dd className="space-y-0.5">
                  {deployment.endpoints.map((url) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-blue-600 dark:text-blue-400 hover:underline break-all"
                    >
                      {url}
                    </a>
                  ))}
                </dd>
              </>
            )}

            {deployment.diagnostic &&
              (deployment.status === "FAILED" ||
                deployment.status === "REQUEST_FAILED") && (
                <>
                  <dt className="text-gray-500 dark:text-gray-400">
                    Diagnostic
                  </dt>
                  <dd>
                    <pre className="whitespace-pre-wrap break-all text-xs text-red-600 dark:text-red-400">
                      {deployment.diagnostic}
                    </pre>
                  </dd>
                </>
              )}
          </dl>
        )}
      </section>

      <section
        className="rounded-lg border border-gray-200 dark:border-gray-800 p-5 space-y-4"
        aria-labelledby="access-gate-heading"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3
              id="access-gate-heading"
              className="text-base font-semibold"
            >
              Access gate
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Passwordless OIDC via Rauthy — magic link and/or federated
              upstream IdP. The platform never sees a password.
            </p>
          </div>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
              enabled
                ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
            }`}
          >
            {enabled ? "Enabled" : "Disabled"}
          </span>
        </div>

        {/* T050 + T052 — descriptor form */}
        <gateFetcher.Form method="post" className="space-y-4">
          <input type="hidden" name="intent" value="gate.save" />
          <input
            type="hidden"
            name="enabled"
            value={enabled ? "true" : "false"}
            id="gate-enabled-hidden"
          />

          {!enabled && <EmptyStateCallout fetcher={gateFetcher} />}

          {enabled && (
            <>
              <LoginMethodFieldset gate={gate} />
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  className="text-xs text-red-600 dark:text-red-400 hover:underline"
                  onClick={(e) => {
                    e.preventDefault();
                    const hidden = (
                      e.currentTarget
                        .closest("form")
                        ?.querySelector(
                          "#gate-enabled-hidden",
                        ) as HTMLInputElement | null
                    );
                    if (hidden) hidden.value = "false";
                    (e.currentTarget.closest("form") as HTMLFormElement).requestSubmit();
                  }}
                  disabled={gateFetcher.state !== "idle"}
                >
                  Disable gate
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300"
                  disabled={gateFetcher.state !== "idle"}
                >
                  {gateFetcher.state === "submitting"
                    ? "Saving…"
                    : "Save"}
                </button>
              </div>
            </>
          )}

          {/* T053 — live-preview hint */}
          {enabled && (
            <LoginPreview
              host={`${envName}.${projectId}.tenants.{org}`}
              magicLink={gate.loginMethodMagicLink}
              federatedProvider={gate.loginMethodFederatedProvider}
            />
          )}

          {/* Inline error surface */}
          {gateFetcher.data && !gateFetcher.data.ok && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {gateFetcher.data.error}
            </p>
          )}
        </gateFetcher.Form>
      </section>

      {/* T051 — allowlist editor; only visible when the gate is enabled */}
      {enabled && (
        <section
          className="rounded-lg border border-gray-200 dark:border-gray-800 p-5 space-y-4"
          aria-labelledby="allowlist-heading"
        >
          <div>
            <h3 id="allowlist-heading" className="text-base font-semibold">
              Allowlist
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Defense-in-depth at the proxy layer. Add an exact email or a
              domain suffix. Email matches are case-insensitive; domain
              matches apply to the email suffix.
            </p>
          </div>
          <AllowlistEditor
            entries={gate.allowlist}
            fetcher={allowlistFetcher}
          />
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EmptyStateCallout({
  fetcher,
}: {
  fetcher: ReturnType<typeof useFetcher>;
}) {
  return (
    <div className="rounded-md bg-gray-50 dark:bg-gray-900/40 p-4 space-y-3">
      <p className="text-sm text-gray-700 dark:text-gray-300">
        This environment is exposed directly on its ingress. Enable the gate
        to require Rauthy authentication before any request reaches the
        tenant pod.
      </p>
      <button
        type="button"
        className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300"
        onClick={(e) => {
          e.preventDefault();
          const form = e.currentTarget.closest("form") as HTMLFormElement;
          const hidden = form.querySelector(
            "#gate-enabled-hidden",
          ) as HTMLInputElement;
          hidden.value = "true";
          form.requestSubmit();
        }}
        disabled={fetcher.state !== "idle"}
      >
        {fetcher.state === "submitting" ? "Enabling…" : "Enable gate"}
      </button>
    </div>
  );
}

function LoginMethodFieldset({ gate }: { gate: AccessGateRead }) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Login methods</legend>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="loginMethodMagicLink"
          value="true"
          defaultChecked={gate.loginMethodMagicLink}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium">Magic link</span>{" "}
          <span className="text-gray-500 dark:text-gray-400">
            — Rauthy emails a one-time link.
          </span>
        </span>
      </label>
      <div className="space-y-1">
        <label className="block text-sm font-medium">
          Federated upstream
        </label>
        <select
          name="loginMethodFederatedProvider"
          defaultValue={gate.loginMethodFederatedProvider ?? ""}
          className="w-56 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1"
        >
          <option value="">— none —</option>
          <option value="google">Google</option>
          <option value="microsoft">Microsoft Entra</option>
          <option value="github">GitHub</option>
          <option value="generic_oidc">Generic OIDC</option>
        </select>
        <input
          name="loginMethodFederatedProviderClientRef"
          type="text"
          placeholder="Auth Provider id in Rauthy"
          defaultValue={gate.loginMethodFederatedProviderClientRef ?? ""}
          className="block w-72 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 mt-1"
        />
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Configure the upstream first in Rauthy admin (Auth Providers),
          then paste its id here.
        </p>
      </div>
    </fieldset>
  );
}

function AllowlistEditor({
  entries,
  fetcher,
}: {
  entries: AccessGateAllowlistEntry[];
  fetcher: ReturnType<typeof useFetcher>;
}) {
  return (
    <div className="space-y-3">
      <fetcher.Form method="post" className="flex items-center gap-2">
        <input type="hidden" name="intent" value="allowlist.add" />
        <select
          name="kind"
          defaultValue="email"
          className="text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1"
        >
          <option value="email">Email</option>
          <option value="domain">Domain</option>
        </select>
        <input
          type="text"
          name="value"
          placeholder="alice@acme.com or acme.com"
          required
          className="flex-1 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1"
        />
        <button
          type="submit"
          className="px-3 py-1 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300"
          disabled={fetcher.state !== "idle"}
        >
          Add
        </button>
      </fetcher.Form>

      {fetcher.data && !fetcher.data.ok && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {fetcher.data.error}
        </p>
      )}

      {entries.length === 0 ? (
        <p className="text-sm italic text-gray-500 dark:text-gray-400">
          No entries yet — without an allowlist, the gate accepts any
          Rauthy-authenticated identity (the Rauthy directory + upstream
          provider rules are the only filter).
        </p>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-gray-800 border border-gray-200 dark:border-gray-800 rounded">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <span className="text-sm font-mono">
                {entry.value}
                <span className="ml-2 text-[10px] uppercase text-gray-500 dark:text-gray-400">
                  {entry.kind}
                </span>
              </span>
              <fetcher.Form method="post">
                <input
                  type="hidden"
                  name="intent"
                  value="allowlist.remove"
                />
                <input type="hidden" name="entryId" value={entry.id} />
                <button
                  type="submit"
                  className="text-xs text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
                  disabled={fetcher.state !== "idle"}
                >
                  Remove
                </button>
              </fetcher.Form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LoginPreview({
  host,
  magicLink,
  federatedProvider,
}: {
  host: string;
  magicLink: boolean;
  federatedProvider: FederatedProvider | null;
}) {
  const buttons: string[] = [];
  if (magicLink) buttons.push("Email me a sign-in link");
  if (federatedProvider) {
    const labels: Record<FederatedProvider, string> = {
      google: "Continue with Google",
      microsoft: "Continue with Microsoft",
      github: "Continue with GitHub",
      generic_oidc: "Continue with SSO",
    };
    buttons.push(labels[federatedProvider]);
  }

  return (
    <div className="rounded-md bg-gray-50 dark:bg-gray-900/40 p-4 space-y-2">
      <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
        End-user preview
      </p>
      <p className="text-sm text-gray-700 dark:text-gray-300">
        When a user visits <span className="font-mono">{host}</span>, Rauthy
        will present:
      </p>
      {buttons.length === 0 ? (
        <p className="text-sm italic text-gray-500 dark:text-gray-400">
          No login methods enabled — the gate will refuse every request.
          Toggle magic-link or set a federated upstream.
        </p>
      ) : (
        <ul className="text-sm space-y-1">
          {buttons.map((label) => (
            <li
              key={label}
              className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 inline-block mr-2"
            >
              {label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
