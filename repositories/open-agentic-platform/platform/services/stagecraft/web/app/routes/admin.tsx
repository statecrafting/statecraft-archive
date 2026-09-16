import { Outlet, useLoaderData, Link } from "react-router";
import { requireAdmin } from "../lib/auth.server";

export async function loader({ request }: { request: Request }) {
  const admin = await requireAdmin(request);
  return { admin };
}

export default function AdminLayout() {
  const { admin } = useLoaderData() as {
    admin: { name: string; email: string };
  };
  return (
    <div className="min-h-full container px-4 mx-auto my-8">
      <nav className="flex gap-4 mb-8 border-b border-gray-200 dark:border-gray-700 pb-4">
        <Link
          to="/admin"
          className="text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
        >
          Admin Home
        </Link>
        <Link
          to="/admin/users"
          className="text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
        >
          Users
        </Link>
        <Link
          to="/admin/audit"
          className="text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
        >
          Audit
        </Link>
        <Link
          to="/admin/projects"
          className="text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
        >
          Projects
        </Link>
        <Link
          to="/admin/sessions"
          className="text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
        >
          Sessions
        </Link>
        <Link
          to="/admin/oidc-providers"
          className="text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
        >
          SSO Providers
        </Link>
      </nav>
      <main>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Admin: {admin.email}
        </h2>
        <Outlet />
      </main>
    </div>
  );
}
