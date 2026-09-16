/**
 * Admin session management UI (spec 080 Phase 6 FR-031).
 *
 * View active sessions for a user and revoke individual or all sessions.
 */

import { Form, redirect, useLoaderData, useSearchParams } from "react-router";
import { createEncoreClient } from "../lib/encore.server";
import { requireAdmin } from "../lib/auth.server";
import { getFormValues } from "../lib/form-data.server";

export async function loader({ request }: { request: Request }) {
  await requireAdmin(request);
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");

  if (!userId) {
    return { sessions: [], userId: null };
  }

  const client = createEncoreClient(request);
  const res = await client.admin.listUserSessions({ userId });
  return { sessions: res.sessions, userId };
}

export async function action({ request }: { request: Request }) {
  await requireAdmin(request);
  const data = await getFormValues(request);
  const intent = String(data.intent);
  const userId = String(data.userId);
  const client = createEncoreClient(request);

  if (intent === "revoke-all") {
    await client.admin.revokeUserSessions({ userId });
  } else if (intent === "revoke-one") {
    const tokenId = String(data.tokenId);
    await client.admin.revokeUserSession({ userId, tokenId });
  }

  return redirect(`/admin/sessions?userId=${userId}`);
}

export default function AdminSessions() {
  const { sessions, userId } = useLoaderData() as {
    sessions: Array<{
      id: string;
      userId: string;
      idpProvider: string;
      platformRole: string;
      orgSlug: string;
      expiresAt: string;
      createdAt: string;
    }>;
    userId: string | null;
  };

  return (
    <div>
      <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
        Session Management
      </h3>

      {/* User ID lookup */}
      <form method="get" className="flex gap-3 mb-6 text-sm">
        <input
          name="userId"
          placeholder="Enter user ID..."
          defaultValue={userId ?? ""}
          className="rounded-md border-gray-300 p-1.5 flex-1 max-w-md dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Look up
        </button>
      </form>

      {userId && sessions.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">No active sessions for this user.</p>
      )}

      {sessions.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {sessions.length} active session{sessions.length !== 1 ? "s" : ""}
            </p>
            <Form method="post" encType="application/x-www-form-urlencoded">
              <input type="hidden" name="intent" value="revoke-all" />
              <input type="hidden" name="userId" value={userId} />
              <button
                type="submit"
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
                onClick={(e) => {
                  if (!window.confirm("Revoke all sessions for this user?")) {
                    e.preventDefault();
                  }
                }}
              >
                Revoke All
              </button>
            </Form>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  <th className="px-3 py-2">Provider</th>
                  <th className="px-3 py-2">Org</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2">Expires</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">
                      {s.idpProvider || "github"}
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">
                      {s.orgSlug}
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">
                      {s.platformRole}
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {new Date(s.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {new Date(s.expiresAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      <Form method="post" encType="application/x-www-form-urlencoded">
                        <input type="hidden" name="intent" value="revoke-one" />
                        <input type="hidden" name="userId" value={userId} />
                        <input type="hidden" name="tokenId" value={s.id} />
                        <button
                          type="submit"
                          className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                        >
                          Revoke
                        </button>
                      </Form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
