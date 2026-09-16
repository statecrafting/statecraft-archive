import { Form, Link, redirect, useLoaderData, useActionData } from "react-router";
import { requireAdmin } from "../lib/auth.server";
import { getFormValues } from "../lib/form-data.server";
import {
  getProject,
  listProjectRepos,
  listEnvironments,
  listProjectMembers,
  deleteProject,
  addProjectRepo,
  removeProjectRepo,
  createEnvironment,
  deleteEnvironment,
} from "../lib/projects-api.server";

export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { id: string };
}) {
  await requireAdmin(request);

  const [projectRes, reposRes, envsRes, membersRes] = await Promise.all([
    getProject(request, params.id),
    listProjectRepos(request, params.id),
    listEnvironments(request, params.id),
    listProjectMembers(request, params.id),
  ]);

  return {
    project: projectRes.project,
    repos: reposRes.repos,
    environments: envsRes.environments,
    members: membersRes.members,
  };
}

export async function action({
  request,
  params,
}: {
  request: Request;
  params: { id: string };
}) {
  const admin = await requireAdmin(request);
  const data = await getFormValues(request);
  const intent = data._intent;

  try {
    if (intent === "delete_project") {
      await deleteProject(request, params.id, admin.userId);
      return redirect("/admin/projects");
    }

    if (intent === "add_repo") {
      await addProjectRepo(request, params.id, {
        githubOrg: data.githubOrg,
        repoName: data.repoName,
        defaultBranch: data.defaultBranch || "main",
        isPrimary: data.isPrimary === "true",
        actorUserId: admin.userId,
      });
      return redirect(`/admin/projects/${params.id}`);
    }

    if (intent === "remove_repo") {
      await removeProjectRepo(
        request,
        params.id,
        data.repoId,
        admin.userId
      );
      return redirect(`/admin/projects/${params.id}`);
    }

    if (intent === "add_env") {
      await createEnvironment(request, params.id, {
        name: data.envName,
        kind: data.envKind,
        autoDeployBranch: data.autoDeployBranch || undefined,
        requiresApproval: data.requiresApproval === "true",
        actorUserId: admin.userId,
      });
      return redirect(`/admin/projects/${params.id}`);
    }

    if (intent === "delete_env") {
      await deleteEnvironment(
        request,
        params.id,
        data.envId,
        admin.userId
      );
      return redirect(`/admin/projects/${params.id}`);
    }

    return { error: "Unknown action" };
  } catch (err: any) {
    return { error: err.message || "Action failed" };
  }
}

export default function AdminProjectDetail() {
  const { project, repos, environments, members } = useLoaderData() as {
    project: {
      id: string;
      name: string;
      slug: string;
      description: string;
      createdAt: string;
    };
    repos: Array<{
      id: string;
      githubOrg: string;
      repoName: string;
      defaultBranch: string;
      isPrimary: boolean;
    }>;
    environments: Array<{
      id: string;
      name: string;
      kind: string;
      k8sNamespace: string | null;
      autoDeployBranch: string | null;
      requiresApproval: boolean;
    }>;
    members: Array<{
      id: string;
      userId: string;
      role: string;
    }>;
  };

  const actionData = useActionData() as { error?: string } | undefined;

  return (
    <div className="space-y-8">
      {actionData?.error && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-400">
          {actionData.error}
        </div>
      )}

      {/* Project Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
            {project.name}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Slug: {project.slug}
          </p>
          {project.description && (
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              {project.description}
            </p>
          )}
        </div>
        <Form method="post" encType="application/x-www-form-urlencoded">
          <input type="hidden" name="_intent" value="delete_project" />
          <button
            type="submit"
            onClick={(e) => {
              if (!confirm("Delete this project and all its data?"))
                e.preventDefault();
            }}
            className="rounded-md border border-red-300 dark:border-red-700 px-3 py-1 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
          >
            Delete Project
          </button>
        </Form>
      </div>

      {/* Repos Section */}
      <section>
        <h4 className="text-md font-medium text-gray-900 dark:text-gray-100 mb-3">
          GitHub Repositories
        </h4>

        {repos.length > 0 && (
          <ul className="divide-y divide-gray-200 dark:divide-gray-700 mb-4">
            {repos.map((r) => (
              <li
                key={r.id}
                className="py-2 flex items-center justify-between"
              >
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  {r.githubOrg}/{r.repoName}
                  <span className="ml-2 text-gray-400">
                    ({r.defaultBranch})
                  </span>
                  {r.isPrimary && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-indigo-100 dark:bg-indigo-900/30 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">
                      primary
                    </span>
                  )}
                </span>
                <Form method="post" encType="application/x-www-form-urlencoded">
                  <input type="hidden" name="_intent" value="remove_repo" />
                  <input type="hidden" name="repoId" value={r.id} />
                  <button
                    type="submit"
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Remove
                  </button>
                </Form>
              </li>
            ))}
          </ul>
        )}

        <Form
          method="post"
          encType="application/x-www-form-urlencoded"
          className="flex flex-wrap gap-2 items-end"
        >
          <input type="hidden" name="_intent" value="add_repo" />
          <input
            name="githubOrg"
            placeholder="org"
            required
            className="rounded-md border-gray-300 p-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 w-32"
          />
          <input
            name="repoName"
            placeholder="repo-name"
            required
            className="rounded-md border-gray-300 p-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 w-40"
          />
          <input
            name="defaultBranch"
            placeholder="main"
            className="rounded-md border-gray-300 p-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 w-24"
          />
          <label className="flex items-center gap-1 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" name="isPrimary" value="true" />
            Primary
          </label>
          <button
            type="submit"
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Add Repo
          </button>
        </Form>
      </section>

      {/* Environments Section */}
      <section>
        <h4 className="text-md font-medium text-gray-900 dark:text-gray-100 mb-3">
          Environments
        </h4>

        {environments.length > 0 && (
          <ul className="divide-y divide-gray-200 dark:divide-gray-700 mb-4">
            {environments.map((e) => (
              <li
                key={e.id}
                className="py-2 flex items-center justify-between"
              >
                <div className="text-sm">
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    {e.name}
                  </span>
                  <span className="ml-2 inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs text-gray-600 dark:text-gray-300">
                    {e.kind}
                  </span>
                  {e.autoDeployBranch && (
                    <span className="ml-2 text-gray-400 text-xs">
                      auto: {e.autoDeployBranch}
                    </span>
                  )}
                  {e.requiresApproval && (
                    <span className="ml-2 text-amber-500 text-xs">
                      requires approval
                    </span>
                  )}
                  {e.k8sNamespace && (
                    <span className="ml-2 text-gray-400 text-xs">
                      ns: {e.k8sNamespace}
                    </span>
                  )}
                </div>
                <Form method="post" encType="application/x-www-form-urlencoded">
                  <input type="hidden" name="_intent" value="delete_env" />
                  <input type="hidden" name="envId" value={e.id} />
                  <button
                    type="submit"
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Delete
                  </button>
                </Form>
              </li>
            ))}
          </ul>
        )}

        <Form
          method="post"
          encType="application/x-www-form-urlencoded"
          className="flex flex-wrap gap-2 items-end"
        >
          <input type="hidden" name="_intent" value="add_env" />
          <input
            name="envName"
            placeholder="env name"
            required
            className="rounded-md border-gray-300 p-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 w-32"
          />
          <select
            name="envKind"
            className="rounded-md border-gray-300 p-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="development">development</option>
            <option value="staging">staging</option>
            <option value="production">production</option>
            <option value="preview">preview</option>
          </select>
          <input
            name="autoDeployBranch"
            placeholder="auto-deploy branch"
            className="rounded-md border-gray-300 p-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 w-40"
          />
          <label className="flex items-center gap-1 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" name="requiresApproval" value="true" />
            Approval
          </label>
          <button
            type="submit"
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Add Environment
          </button>
        </Form>
      </section>

      {/* Members Section */}
      <section>
        <h4 className="text-md font-medium text-gray-900 dark:text-gray-100 mb-3">
          Members
        </h4>
        {members.length > 0 ? (
          <ul className="divide-y divide-gray-200 dark:divide-gray-700">
            {members.map((m) => (
              <li
                key={m.id}
                className="py-2 flex items-center justify-between text-sm"
              >
                <span className="text-gray-700 dark:text-gray-300">
                  {m.userId}
                </span>
                <span className="inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs text-gray-600 dark:text-gray-300">
                  {m.role}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No members yet.
          </p>
        )}
      </section>

      <div className="pt-4">
        <Link
          to="/admin/projects"
          className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          Back to Projects
        </Link>
      </div>
    </div>
  );
}
