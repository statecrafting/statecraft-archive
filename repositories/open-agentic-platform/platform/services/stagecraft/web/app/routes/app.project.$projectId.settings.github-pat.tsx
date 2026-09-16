import { Form, useActionData, useLoaderData, useNavigation, useParams } from "react-router";
import { requireUser } from "../lib/auth.server";
import {
  getProjectPat,
  storeProjectPat,
  revokeProjectPat,
  validateProjectPat,
  type ProjectPatMetadata,
  type ProjectPatValidation,
} from "../lib/factory-api.server";

/**
 * Project GitHub PAT settings (spec 109 §6).
 *
 * Project-scoped credential used for repo clone/push/create against GitHub
 * orgs that do NOT have the OAP App installed. Separate from the user PAT
 * under /app/settings/github-pat (which is for membership resolution).
 */

type ActionResult =
  | { kind: "stored"; result: ProjectPatValidation }
  | { kind: "validated"; result: ProjectPatValidation }
  | { kind: "revoked"; revoked: boolean }
  | { kind: "error"; message: string };

export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { projectId: string };
}) {
  await requireUser(request);
  const pat = await getProjectPat(request, params.projectId).catch<ProjectPatMetadata>(
    () => ({ exists: false })
  );
  return { pat };
}

export async function action({
  request,
  params,
}: {
  request: Request;
  params: { projectId: string };
}) {
  await requireUser(request);
  const form = await request.formData();
  const intent = form.get("intent");

  try {
    if (intent === "store") {
      const token = String(form.get("token") ?? "").trim();
      if (!token) return { kind: "error", message: "Paste a token before saving." };
      const result = await storeProjectPat(request, params.projectId, token);
      return { kind: "stored", result } satisfies ActionResult;
    }

    if (intent === "validate") {
      const result = await validateProjectPat(request, params.projectId);
      return { kind: "validated", result } satisfies ActionResult;
    }

    if (intent === "revoke") {
      const { revoked } = await revokeProjectPat(request, params.projectId);
      return { kind: "revoked", revoked } satisfies ActionResult;
    }

    return { kind: "error", message: `Unknown intent: ${String(intent)}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed";
    return { kind: "error", message } satisfies ActionResult;
  }
}

function formatDate(s?: string | null): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

function reasonLabel(reason?: string): string {
  switch (reason) {
    case "pat_invalid":
      return "Token rejected by GitHub. It may have been revoked or expired.";
    case "pat_rate_limited":
      return "GitHub rate-limited the check. Try again in a few minutes.";
    case "pat_saml_not_authorized":
      return "Token is not SAML-authorized for the target org. Open the token on GitHub and enable SSO.";
    default:
      return "Token could not be validated.";
  }
}

export default function ProjectGithubPatSettings() {
  const { pat } = useLoaderData() as { pat: ProjectPatMetadata };
  const actionData = useActionData() as ActionResult | undefined;
  const nav = useNavigation();
  const params = useParams();
  const busy = nav.state !== "idle";

  const latestResult: ProjectPatValidation | undefined =
    actionData && (actionData.kind === "stored" || actionData.kind === "validated")
      ? actionData.result
      : undefined;

  const hasActive = pat.exists && actionData?.kind !== "revoked";

  return (
    <div className="space-y-6 max-w-2xl">
      <header>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wider mb-2">
          Project GitHub Access Token
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Project-scoped GitHub credential used when this project's repo lives in
          an org that does not have the OAP GitHub App installed. Tokens are
          encrypted at rest, never shown after save, and are used only by the
          platform to clone, push, and create repos for this project.
        </p>
      </header>

      {actionData?.kind === "error" && (
        <div className="rounded-md border border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-900/30 px-3 py-2 text-sm text-red-700 dark:text-red-200">
          {actionData.message}
        </div>
      )}

      {actionData?.kind === "revoked" && (
        <div className="rounded-md border border-gray-300 bg-gray-50 dark:border-gray-700 dark:bg-gray-900 px-3 py-2 text-sm text-gray-700 dark:text-gray-200">
          Token revoked.
        </div>
      )}

      {latestResult && !latestResult.ok && (
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/30 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          {reasonLabel(latestResult.reason)}
        </div>
      )}

      {hasActive ? (
        <section className="rounded-md border border-gray-200 dark:border-gray-700 p-4 space-y-3">
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="text-gray-500 dark:text-gray-400">Prefix</div>
            <div className="col-span-2 font-mono text-gray-900 dark:text-gray-100">
              {pat.tokenPrefix}…
            </div>

            <div className="text-gray-500 dark:text-gray-400">Format</div>
            <div className="col-span-2 text-gray-900 dark:text-gray-100">
              {pat.isFineGrained ? "Fine-grained" : "Classic"}
            </div>

            <div className="text-gray-500 dark:text-gray-400">GitHub user</div>
            <div className="col-span-2 font-mono text-gray-900 dark:text-gray-100">
              {pat.githubLogin ?? "—"}
            </div>

            <div className="text-gray-500 dark:text-gray-400">Scopes</div>
            <div className="col-span-2 text-gray-900 dark:text-gray-100">
              {pat.scopes && pat.scopes.length > 0 ? pat.scopes.join(", ") : "—"}
            </div>

            <div className="text-gray-500 dark:text-gray-400">Last used</div>
            <div className="col-span-2 text-gray-900 dark:text-gray-100">
              {formatDate(pat.lastUsedAt)}
            </div>

            <div className="text-gray-500 dark:text-gray-400">Last checked</div>
            <div className="col-span-2 text-gray-900 dark:text-gray-100">
              {formatDate(pat.lastCheckedAt)}
            </div>

            <div className="text-gray-500 dark:text-gray-400">Added</div>
            <div className="col-span-2 text-gray-900 dark:text-gray-100">
              {formatDate(pat.createdAt)}
            </div>
          </div>

          <div className="flex gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
            <Form method="post">
              <input type="hidden" name="intent" value="validate" />
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                Revalidate
              </button>
            </Form>

            <Form method="post">
              <input type="hidden" name="intent" value="revoke" />
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:bg-gray-800 dark:text-red-300 dark:hover:bg-red-900/20"
              >
                Revoke
              </button>
            </Form>
          </div>
        </section>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No project token on file. Paste one below to allow this project to
          access repos outside the platform-installed GitHub org.
        </p>
      )}

      <section className="rounded-md border border-gray-200 dark:border-gray-700 p-4">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
          {hasActive ? "Replace token" : "Add token"}
        </h4>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Fine-grained tokens are preferred. The token needs <em>Contents</em>
          {" "}and <em>Administration</em> (for creating new repos) permissions on
          the target org's repositories.
        </p>

        <Form method="post" className="space-y-3">
          <input type="hidden" name="intent" value="store" />
          <label className="block">
            <span className="sr-only">Project GitHub PAT (project {params.projectId})</span>
            <input
              type="password"
              name="token"
              autoComplete="off"
              spellCheck={false}
              placeholder="github_pat_… or ghp_…"
              className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-mono text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
            />
          </label>

          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {hasActive ? "Replace token" : "Save token"}
          </button>
        </Form>

        {latestResult?.ok && (
          <p className="mt-3 text-sm text-green-700 dark:text-green-400">
            Validated as <span className="font-mono">{latestResult.githubLogin}</span>
            {latestResult.scopes.length > 0 &&
              ` · scopes: ${latestResult.scopes.join(", ")}`}
          </p>
        )}
      </section>
    </div>
  );
}
