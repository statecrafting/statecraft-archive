/**
 * Project Settings → Repository tab.
 *
 * Lists every project_repo bound to this project, lets the user attach a
 * new GitHub repo, and lets them flip the primary flag. The primary repo
 * is what the dashboard's Clone affordance (spec 113 §FR-007) reads, and
 * what the Open-in-OPC bundle treats as the source of truth — so this
 * page is also the cure for "imported project doesn't show Clone": the
 * user can promote the right row from here without touching the DB.
 *
 * Multi-repo support is intentional. A project can carry a production
 * repo alongside a dev / experimental repo; flipping primary lets the
 * user steer which one Clone, Open-in-OPC, and pipeline tooling target,
 * without re-importing.
 */

import {
  Form,
  Link,
  useFetcher,
  useLoaderData,
  useOutletContext,
  useParams,
} from "react-router";
import { useState } from "react";
import { requireUser } from "../lib/auth.server";
import {
  addProjectRepo,
  listProjectRepos,
  removeProjectRepo,
  setPrimaryProjectRepo,
} from "../lib/projects-api.server";

type RepoRow = {
  id: string;
  projectId: string;
  githubOrg: string;
  repoName: string;
  defaultBranch: string;
  isPrimary: boolean;
  githubInstallId: number | null;
  createdAt: string;
  updatedAt: string;
};

interface LoaderData {
  repos: RepoRow[];
}

interface ProjectCtx {
  project: { id: string; name: string; slug: string };
}

export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { projectId: string };
}): Promise<LoaderData> {
  await requireUser(request);
  try {
    const res = await listProjectRepos(request, params.projectId);
    const repos: RepoRow[] = (res.repos ?? []).map((r: any) => ({
      id: r.id,
      projectId: r.projectId,
      githubOrg: r.githubOrg,
      repoName: r.repoName,
      defaultBranch: r.defaultBranch,
      isPrimary: Boolean(r.isPrimary),
      githubInstallId: r.githubInstallId ?? null,
      createdAt:
        typeof r.createdAt === "string"
          ? r.createdAt
          : new Date(r.createdAt).toISOString(),
      updatedAt:
        typeof r.updatedAt === "string"
          ? r.updatedAt
          : new Date(r.updatedAt).toISOString(),
    }));
    return { repos };
  } catch {
    return { repos: [] };
  }
}

export async function action({
  request,
  params,
}: {
  request: Request;
  params: { projectId: string };
}) {
  const user = await requireUser(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "add") {
    const githubOrg = String(form.get("githubOrg") ?? "").trim();
    const repoName = String(form.get("repoName") ?? "").trim();
    const defaultBranch = String(form.get("defaultBranch") ?? "main").trim();
    const isPrimary = form.get("isPrimary") === "on";
    if (!githubOrg || !repoName) {
      return { error: "GitHub org and repo name are required." };
    }
    try {
      await addProjectRepo(request, params.projectId, {
        githubOrg,
        repoName,
        defaultBranch: defaultBranch || "main",
        isPrimary,
        actorUserId: user.userId,
      });
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: msg };
    }
  }

  if (intent === "set-primary") {
    const repoId = String(form.get("repoId") ?? "");
    try {
      await setPrimaryProjectRepo(request, params.projectId, repoId);
      return { ok: true };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (intent === "remove") {
    const repoId = String(form.get("repoId") ?? "");
    try {
      await removeProjectRepo(request, params.projectId, repoId, user.userId);
      return { ok: true };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return null;
}

export default function ReposSettings() {
  const { repos } = useLoaderData() as LoaderData;
  const { project } = useOutletContext<ProjectCtx>();
  const params = useParams();
  const projectId = params.projectId ?? project?.id ?? "";
  const fetcher = useFetcher<{ error?: string; ok?: true }>();
  const [showAdd, setShowAdd] = useState(false);

  const hasPrimary = repos.some((r) => r.isPrimary);
  const submitting =
    fetcher.state !== "idle" && fetcher.formData?.get("intent") != null;

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wider">
              Repositories
            </h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 max-w-xl">
              Bind GitHub repositories to this project. The primary repo
              drives the Clone affordance and Open-in-OPC. You can attach
              additional repos (e.g. a dev / experimental copy) and flip
              the primary at any time.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            {showAdd ? "Cancel" : "Attach repository"}
          </button>
        </div>

        {fetcher.data?.error && (
          <div className="mb-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {fetcher.data.error}
          </div>
        )}

        {!hasPrimary && repos.length > 0 && (
          <div className="mb-3 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            No repository is marked primary. Clone and Open-in-OPC are
            disabled for this project until one is promoted.
          </div>
        )}

        {showAdd && (
          <fetcher.Form
            method="post"
            className="mb-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4 space-y-3"
            onSubmit={() => setShowAdd(false)}
          >
            <input type="hidden" name="intent" value="add" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="githubOrg"
                  className="block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  GitHub org
                </label>
                <input
                  type="text"
                  id="githubOrg"
                  name="githubOrg"
                  required
                  placeholder="acme-org"
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2.5 py-1.5 text-sm font-mono text-gray-900 dark:text-gray-100"
                />
              </div>
              <div>
                <label
                  htmlFor="repoName"
                  className="block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  Repository name
                </label>
                <input
                  type="text"
                  id="repoName"
                  name="repoName"
                  required
                  placeholder="my-service"
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2.5 py-1.5 text-sm font-mono text-gray-900 dark:text-gray-100"
                />
              </div>
              <div>
                <label
                  htmlFor="defaultBranch"
                  className="block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  Default branch
                </label>
                <input
                  type="text"
                  id="defaultBranch"
                  name="defaultBranch"
                  defaultValue="main"
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2.5 py-1.5 text-sm font-mono text-gray-900 dark:text-gray-100"
                />
              </div>
              <div className="flex items-end">
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    name="isPrimary"
                    defaultChecked={!hasPrimary}
                    className="h-4 w-4"
                  />
                  Mark as primary
                </label>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {submitting ? "Attaching…" : "Attach"}
              </button>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              >
                Cancel
              </button>
            </div>
          </fetcher.Form>
        )}

        {repos.length === 0 ? (
          <div className="border border-dashed border-gray-300 dark:border-gray-700 rounded-lg px-6 py-10 text-center">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              No repositories attached
            </p>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Attach a GitHub repository to enable Clone and Open-in-OPC.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {repos.map((r) => (
              <RepoRowItem
                key={r.id}
                repo={r}
                projectId={projectId}
                disabled={submitting}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RepoRowItem({
  repo,
  projectId: _projectId,
  disabled,
}: {
  repo: RepoRow;
  projectId: string;
  disabled: boolean;
}) {
  const githubUrl = `https://github.com/${repo.githubOrg}/${repo.repoName}`;
  return (
    <li className="flex items-center gap-4 px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/60">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            to={githubUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline font-mono"
          >
            {repo.githubOrg}/{repo.repoName}
          </Link>
          {repo.isPrimary && (
            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
              PRIMARY
            </span>
          )}
        </div>
        <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 font-mono">
          branch: {repo.defaultBranch}
          {repo.githubInstallId != null && (
            <>
              {" · "}install: {repo.githubInstallId}
            </>
          )}
        </div>
      </div>
      <div className="flex-shrink-0 flex items-center gap-1">
        {!repo.isPrimary && (
          <Form method="post">
            <input type="hidden" name="intent" value="set-primary" />
            <input type="hidden" name="repoId" value={repo.id} />
            <button
              type="submit"
              disabled={disabled}
              className="inline-flex items-center rounded-md border border-gray-300 dark:border-gray-700 px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              Make primary
            </button>
          </Form>
        )}
        <Form
          method="post"
          onSubmit={(e) => {
            if (
              !confirm(
                `Detach ${repo.githubOrg}/${repo.repoName} from this project? The GitHub repository itself is not deleted.`
              )
            ) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="intent" value="remove" />
          <input type="hidden" name="repoId" value={repo.id} />
          <button
            type="submit"
            disabled={disabled}
            className="inline-flex items-center rounded-md border border-red-200 dark:border-red-800 px-2.5 py-1.5 text-xs font-medium text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50"
          >
            Detach
          </button>
        </Form>
      </div>
    </li>
  );
}
