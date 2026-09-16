/**
 * Factory Upstreams config (spec 108 Phase 2 + spec 109 §6 PAT).
 *
 * Two sub-forms on one page:
 *   1. Upstream sources — factory + template repos with refs.
 *   2. Access token (PAT) — org-scoped credential the sync worker uses to
 *      clone those repos. Required when upstreams are private.
 *
 * The PAT and the upstream form submit via distinct Form `intent` values
 * so they don't stomp each other.
 */

import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { requireUser } from "../lib/auth.server";
import {
  getFactoryUpstreamPat,
  getFactoryUpstreams,
  revokeFactoryUpstreamPat,
  storeFactoryUpstreamPat,
  upsertFactoryUpstreams,
  validateFactoryUpstreamPat,
  type FactoryUpstream,
  type FactoryUpstreamPatMetadata,
  type FactoryUpstreamPatValidation,
} from "../lib/factory-api.server";

type LoaderData = {
  upstream: FactoryUpstream | null;
  canConfigure: boolean;
  pat: FactoryUpstreamPatMetadata;
};

export async function loader({ request }: { request: Request }): Promise<LoaderData> {
  const user = await requireUser(request);
  const canConfigure =
    user.platformRole === "owner" || user.platformRole === "admin";

  const [{ upstream }, pat] = await Promise.all([
    getFactoryUpstreams(request),
    canConfigure
      ? getFactoryUpstreamPat(request).catch(() => ({ exists: false }))
      : Promise.resolve({ exists: false as const }),
  ]);

  return { upstream, canConfigure, pat };
}

type ActionData = {
  error?: string;
  patResult?: FactoryUpstreamPatValidation;
  patRevoked?: boolean;
  ok?: true;
};

export async function action({
  request,
}: {
  request: Request;
}): Promise<ActionData | Response> {
  const user = await requireUser(request);
  if (user.platformRole !== "owner" && user.platformRole !== "admin") {
    return { error: "Only org admins can configure factory upstreams." };
  }

  const form = await request.formData();
  const intent = (form.get("intent") as string) ?? "upsert-upstreams";

  if (intent === "store-pat") {
    const token = ((form.get("token") as string) ?? "").trim();
    if (!token) return { error: "Token is required." };
    try {
      const patResult = await storeFactoryUpstreamPat(request, token);
      return { patResult };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : "Failed to store token.",
      };
    }
  }

  if (intent === "revoke-pat") {
    try {
      const { revoked } = await revokeFactoryUpstreamPat(request);
      return { patRevoked: revoked };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : "Failed to revoke token.",
      };
    }
  }

  if (intent === "validate-pat") {
    try {
      const patResult = await validateFactoryUpstreamPat(request);
      return { patResult };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : "Failed to validate token.",
      };
    }
  }

  const factorySource = ((form.get("factorySource") as string) ?? "").trim();
  const templateSource = ((form.get("templateSource") as string) ?? "").trim();
  const factoryRef = ((form.get("factoryRef") as string) ?? "main").trim();
  const templateRef = ((form.get("templateRef") as string) ?? "main").trim();

  if (!factorySource || !templateSource) {
    return { error: "Both factory and template sources are required." };
  }

  try {
    await upsertFactoryUpstreams(request, {
      factorySource,
      factoryRef,
      templateSource,
      templateRef,
    });
    return redirect("/app/factory");
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to save upstreams.",
    };
  }
}

export default function UpstreamsForm() {
  const { upstream, canConfigure, pat } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wider">
          Upstream configuration
        </h2>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          Point Factory at the two GitHub repositories that feed your
          adapters, contracts, and processes. Changes take effect on the
          next sync.
        </p>
      </div>

      {!canConfigure && (
        <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          You can view the current configuration but only org admins can change it.
        </div>
      )}

      {actionData?.error && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {actionData.error}
        </div>
      )}

      <Form method="post" className="space-y-6">
        <input type="hidden" name="intent" value="upsert-upstreams" />
        <RepoField
          name="factorySource"
          refName="factoryRef"
          label="Factory source"
          hint="Canonical process definitions and adapter scaffolds."
          placeholder="statecrafting/factory"
          defaultRepo={upstream?.factorySource ?? ""}
          defaultRef={upstream?.factoryRef ?? "main"}
          disabled={!canConfigure}
        />

        <RepoField
          name="templateSource"
          refName="templateRef"
          label="Template source"
          hint="Per-project templates consumed by the factory."
          placeholder="statecrafting/template"
          defaultRepo={upstream?.templateSource ?? ""}
          defaultRef={upstream?.templateRef ?? "main"}
          disabled={!canConfigure}
        />

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!canConfigure || isSubmitting}
            className="inline-flex justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Saving…" : upstream ? "Save changes" : "Configure"}
          </button>
          <a
            href="/app/factory"
            className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
          >
            Cancel
          </a>
        </div>
      </Form>

      {canConfigure && (
        <PatSection pat={pat} result={actionData?.patResult} revoked={actionData?.patRevoked} />
      )}
    </div>
  );
}

function RepoField({
  name,
  refName,
  label,
  hint,
  placeholder,
  defaultRepo,
  defaultRef,
  disabled,
}: {
  name: string;
  refName: string;
  label: string;
  hint: string;
  placeholder: string;
  defaultRepo: string;
  defaultRef: string;
  disabled: boolean;
}) {
  return (
    <fieldset className="space-y-3 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <legend className="px-1 text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </legend>
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
          Repository (owner/repo)
        </label>
        <input
          type="text"
          name={name}
          required
          disabled={disabled}
          defaultValue={defaultRepo}
          placeholder={placeholder}
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-mono shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:disabled:bg-gray-800/60"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
          Git ref
        </label>
        <input
          type="text"
          name={refName}
          disabled={disabled}
          defaultValue={defaultRef}
          placeholder="main"
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-mono shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:disabled:bg-gray-800/60"
        />
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">{hint}</p>
    </fieldset>
  );
}

function PatSection({
  pat,
  result,
  revoked,
}: {
  pat: FactoryUpstreamPatMetadata;
  result?: FactoryUpstreamPatValidation;
  revoked?: boolean;
}) {
  const showExisting = pat.exists && !revoked;

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 dark:border-gray-700 p-5">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Access token
        </h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          The sync worker uses this GitHub PAT to clone the upstream
          repositories. Use a fine-grained token with read-only contents
          permission on the two repos. Without a token the worker will
          attempt anonymous clone — which only works for public repos.
        </p>
      </div>

      {result && !result.ok && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-400">
          Token rejected: {result.reason ?? "invalid"}
        </div>
      )}

      {result && result.ok && (
        <div className="rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          Token validated against GitHub as <code className="font-mono">{result.githubLogin ?? "(unknown)"}</code>.
        </div>
      )}

      {revoked && (
        <div className="rounded-md bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm text-gray-700 dark:text-gray-300">
          Token revoked.
        </div>
      )}

      {showExisting && (
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <dt className="text-gray-500 dark:text-gray-400">Prefix</dt>
          <dd className="font-mono text-gray-900 dark:text-gray-100">
            {pat.tokenPrefix}…
          </dd>
          <dt className="text-gray-500 dark:text-gray-400">Kind</dt>
          <dd className="text-gray-900 dark:text-gray-100">
            {pat.isFineGrained ? "fine-grained" : "classic"}
          </dd>
          <dt className="text-gray-500 dark:text-gray-400">GitHub user</dt>
          <dd className="font-mono text-gray-900 dark:text-gray-100">
            {pat.githubLogin ?? "—"}
          </dd>
          <dt className="text-gray-500 dark:text-gray-400">Scopes</dt>
          <dd className="text-gray-900 dark:text-gray-100">
            {pat.scopes && pat.scopes.length > 0 ? pat.scopes.join(", ") : "—"}
          </dd>
          <dt className="text-gray-500 dark:text-gray-400">Last checked</dt>
          <dd className="text-gray-900 dark:text-gray-100">
            {pat.lastCheckedAt
              ? new Date(pat.lastCheckedAt).toLocaleString()
              : "—"}
          </dd>
          <dt className="text-gray-500 dark:text-gray-400">Last used</dt>
          <dd className="text-gray-900 dark:text-gray-100">
            {pat.lastUsedAt ? new Date(pat.lastUsedAt).toLocaleString() : "never"}
          </dd>
        </dl>
      )}

      <Form method="post" className="flex flex-col gap-3">
        <input type="hidden" name="intent" value="store-pat" />
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
          Paste token
        </label>
        <input
          type="password"
          name="token"
          autoComplete="off"
          placeholder="github_pat_… or ghp_…"
          className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-mono shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="inline-flex justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            {showExisting ? "Replace token" : "Save token"}
          </button>
        </div>
      </Form>

      {showExisting && (
        <div className="flex items-center gap-3 pt-2 border-t border-gray-100 dark:border-gray-800">
          <Form method="post">
            <input type="hidden" name="intent" value="validate-pat" />
            <button
              type="submit"
              className="text-sm text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
            >
              Re-validate against GitHub
            </button>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="revoke-pat" />
            <button
              type="submit"
              className="text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            >
              Revoke token
            </button>
          </Form>
        </div>
      )}
    </div>
  );
}
