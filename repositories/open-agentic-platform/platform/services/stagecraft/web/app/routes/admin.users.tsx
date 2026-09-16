import { Form, redirect, useLoaderData } from "react-router";
import { createEncoreClient } from "../lib/encore.server";
import { requireAdmin } from "../lib/auth.server";
import { getFormValues } from "../lib/form-data.server";

export async function loader({ request }: { request: Request }) {
  const admin = await requireAdmin(request);
  const client = createEncoreClient(request);
  const res = await client.admin.listUsers();
  return { admin, users: res.users };
}

export async function action({ request }: { request: Request }) {
  const admin = await requireAdmin(request);
  const data = await getFormValues(request);
  const intent = String(data.intent ?? "set-role");
  const userId = String(data.userId);
  const client = createEncoreClient(request);

  if (intent === "set-disabled") {
    const disabled = String(data.disabled) === "true";
    await client.admin.setDisabled({ userId, disabled });
  } else {
    const role = String(data.role) as "user" | "admin";
    await client.admin.setRole({ userId, role });
  }

  return redirect("/admin/users");
}

export default function AdminUsers() {
  const { admin, users } = useLoaderData() as {
    admin: { userId: string };
    users: Array<{
      id: string;
      email: string;
      name: string;
      role: string;
      disabled: boolean;
      lastLoginAt: string | null;
      activeSessionCount: number;
      createdAt: string;
    }>;
  };

  return (
    <div>
      <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
        Users
      </h3>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead>
            <tr className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Sessions</th>
              <th className="px-3 py-2">Last Login</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {users.map((u) => (
              <tr key={u.id} className={u.disabled ? "opacity-60" : ""}>
                <td className="px-3 py-3 text-sm text-gray-700 dark:text-gray-300">
                  {u.email}
                </td>
                <td className="px-3 py-3">
                  <Form method="post" encType="application/x-www-form-urlencoded" className="flex items-center gap-2">
                    <input type="hidden" name="intent" value="set-role" />
                    <input type="hidden" name="userId" value={u.id} />
                    <select
                      name="role"
                      defaultValue={u.role}
                      className="rounded-md border-gray-300 p-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                    >
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>
                    <button
                      type="submit"
                      className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700"
                    >
                      Save
                    </button>
                  </Form>
                </td>
                <td className="px-3 py-3 text-sm">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    u.disabled
                      ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                      : "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                  }`}>
                    {u.disabled ? "Disabled" : "Active"}
                  </span>
                </td>
                <td className="px-3 py-3 text-sm text-gray-700 dark:text-gray-300">
                  {u.activeSessionCount}
                </td>
                <td className="px-3 py-3 text-sm text-gray-500 dark:text-gray-400">
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : "Never"}
                </td>
                <td className="px-3 py-3">
                  {u.id !== admin.userId && (
                    <Form method="post" encType="application/x-www-form-urlencoded">
                      <input type="hidden" name="intent" value="set-disabled" />
                      <input type="hidden" name="userId" value={u.id} />
                      <input type="hidden" name="disabled" value={String(!u.disabled)} />
                      <button
                        type="submit"
                        className={`rounded-md px-2 py-1 text-xs font-medium ${
                          u.disabled
                            ? "bg-green-600 text-white hover:bg-green-700"
                            : "bg-red-600 text-white hover:bg-red-700"
                        }`}
                        onClick={(e) => {
                          if (!u.disabled && !window.confirm(`Disable ${u.email}? This will revoke all their sessions.`)) {
                            e.preventDefault();
                          }
                        }}
                      >
                        {u.disabled ? "Enable" : "Disable"}
                      </button>
                    </Form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
