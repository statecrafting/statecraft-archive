import { Link, useLoaderData } from "react-router";
import { requireAdmin } from "../lib/auth.server";
import { listProjects } from "../lib/projects-api.server";

export async function loader({ request }: { request: Request }) {
  await requireAdmin(request);
  const res = await listProjects(request);
  return { projects: res.projects };
}

export default function AdminProjectsList() {
  const { projects } = useLoaderData() as {
    projects: Array<{
      id: string;
      name: string;
      slug: string;
      description: string;
      createdAt: string;
    }>;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
          Projects
        </h3>
        <Link
          to="/admin/projects/new"
          className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          New Project
        </Link>
      </div>

      {projects.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400">
          No projects yet. Create one to get started.
        </p>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
          {projects.map((p) => (
            <li key={p.id} className="py-3">
              <Link
                to={`/admin/projects/${p.id}`}
                className="flex items-center justify-between gap-4 group"
              >
                <div>
                  <span className="font-medium text-gray-900 dark:text-gray-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                    {p.name}
                  </span>
                  <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">
                    ({p.slug})
                  </span>
                  {p.description && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      {p.description}
                    </p>
                  )}
                </div>
                <span className="text-sm text-gray-400">
                  {new Date(p.createdAt).toLocaleDateString()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
