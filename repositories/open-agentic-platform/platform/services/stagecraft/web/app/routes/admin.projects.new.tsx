import { Form, redirect, useActionData } from "react-router";
import { requireAdmin } from "../lib/auth.server";
import { getFormValues } from "../lib/form-data.server";
import { createProject } from "../lib/projects-api.server";

export async function action({ request }: { request: Request }) {
  const admin = await requireAdmin(request);
  const data = await getFormValues(request);

  const name = data.name?.trim();
  const slug = data.slug?.trim();
  const description = data.description?.trim() || "";

  if (!name || !slug) {
    return { error: "Name and slug are required" };
  }

  if (!/^[a-z0-9-]+$/.test(slug)) {
    return { error: "Slug must be lowercase alphanumeric with hyphens only" };
  }

  try {
    const res = await createProject(request, {
      name,
      slug,
      description,
      actorUserId: admin.userId,
    });
    return redirect(`/admin/projects/${res.project.id}`);
  } catch (err: any) {
    return { error: err.message || "Failed to create project" };
  }
}

export default function AdminProjectNew() {
  const actionData = useActionData() as { error?: string } | undefined;

  return (
    <div className="max-w-lg">
      <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
        New Project
      </h3>

      {actionData?.error && (
        <div className="mb-4 rounded-md bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-400">
          {actionData.error}
        </div>
      )}

      <Form
        method="post"
        encType="application/x-www-form-urlencoded"
        className="space-y-4"
      >
        <div>
          <label
            htmlFor="name"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            placeholder="My Project"
            className="mt-1 block w-full rounded-md border-gray-300 p-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
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
            id="slug"
            name="slug"
            type="text"
            required
            placeholder="my-project"
            pattern="[a-z0-9-]+"
            className="mt-1 block w-full rounded-md border-gray-300 p-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Lowercase letters, numbers, and hyphens only. Used in URLs and K8s
            namespaces.
          </p>
        </div>

        <div>
          <label
            htmlFor="description"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Description
          </label>
          <textarea
            id="description"
            name="description"
            rows={3}
            placeholder="What is this project about?"
            className="mt-1 block w-full rounded-md border-gray-300 p-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Create Project
          </button>
          <a
            href="/admin/projects"
            className="rounded-md border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Cancel
          </a>
        </div>
      </Form>
    </div>
  );
}
