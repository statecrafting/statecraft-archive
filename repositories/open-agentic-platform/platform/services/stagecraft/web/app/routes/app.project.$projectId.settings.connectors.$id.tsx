import {
  useLoaderData,
  useActionData,
  useFetcher,
  Form,
  redirect,
  useNavigation,
  Link,
  useParams,
} from "react-router";
import { requireUser } from "../lib/auth.server";
import {
  getConnector,
  updateConnector,
  deleteConnector,
  triggerSync,
  testConnectorConnection,
  listSyncRuns,
} from "../lib/project-api.server";
import type {
  SourceConnectorRow,
  SyncRunRow,
} from "../lib/project-api.server";
import { useState } from "react";

export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { projectId: string; id: string };
}) {
  await requireUser(request);
  const [connRes, runsRes] = await Promise.all([
    getConnector(request, params.projectId, params.id),
    listSyncRuns(request, params.projectId, params.id).catch(() => ({
      runs: [] as SyncRunRow[],
    })),
  ]);
  return { connector: connRes.connector, syncRuns: runsRes.runs };
}

export async function action({
  request,
  params,
}: {
  request: Request;
  params: { projectId: string; id: string };
}) {
  await requireUser(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "update") {
    const name = form.get("name") as string;
    const syncSchedule = (form.get("syncSchedule") as string) || null;
    const status = form.get("status") as string;

    // Build type-specific config
    const configStr = form.get("config") as string;
    let config: Record<string, unknown> | undefined;
    if (configStr) {
      try {
        config = JSON.parse(configStr);
      } catch {
        return { error: "Invalid JSON in config" };
      }
    }

    try {
      await updateConnector(request, params.projectId, params.id, {
        name,
        syncSchedule,
        status,
        ...(config && { config }),
      });
      return { success: "Connector updated" };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : "Failed to update",
      };
    }
  }

  if (intent === "delete") {
    try {
      await deleteConnector(request, params.projectId, params.id);
      return redirect(`/app/project/${params.projectId}/settings/connectors`);
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : "Failed to delete",
      };
    }
  }

  if (intent === "sync") {
    try {
      const res = await triggerSync(request, params.projectId, params.id);
      return { success: `Sync started (run: ${res.syncRunId})` };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : "Failed to trigger sync",
      };
    }
  }

  if (intent === "test") {
    try {
      const res = await testConnectorConnection(
        request,
        params.projectId,
        params.id,
      );
      if (res.success) {
        return { success: "Connection test passed" };
      }
      return { error: `Connection test failed: ${res.error}` };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : "Test failed",
      };
    }
  }

  return null;
}

const TYPE_LABELS: Record<string, string> = {
  upload: "Direct Upload",
  sharepoint: "SharePoint Online",
  s3: "Amazon S3",
  "azure-blob": "Azure Blob Storage",
  gcs: "Google Cloud Storage",
};

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "disabled", label: "Disabled" },
];

const SYNC_SCHEDULES = [
  { value: "", label: "Manual only" },
  { value: "15m", label: "Every 15 minutes" },
  { value: "30m", label: "Every 30 minutes" },
  { value: "1h", label: "Every hour" },
  { value: "6h", label: "Every 6 hours" },
  { value: "12h", label: "Every 12 hours" },
  { value: "24h", label: "Every 24 hours" },
];

const RUN_STATUS_COLORS: Record<string, string> = {
  running: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

export default function ConnectorDetail() {
  const { connector, syncRuns } = useLoaderData() as {
    connector: SourceConnectorRow;
    syncRuns: SyncRunRow[];
  };
  const actionData = useActionData() as
    | { error?: string; success?: string }
    | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const fetcher = useFetcher();
  const [showDelete, setShowDelete] = useState(false);
  const { projectId } = useParams() as { projectId: string };

  return (
    <div className="max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link
            to={`/app/project/${projectId}/settings/connectors`}
            className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
          >
            &larr; All connectors
          </Link>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wider mt-1">
            {connector.name}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {TYPE_LABELS[connector.type] ?? connector.type} &middot;{" "}
            {connector.id}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {connector.type !== "upload" && connector.status === "active" && (
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="sync" />
              <button
                type="submit"
                className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
              >
                Sync now
              </button>
            </fetcher.Form>
          )}
          {connector.type !== "upload" && (
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="test" />
              <button
                type="submit"
                className="inline-flex items-center rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Test connection
              </button>
            </fetcher.Form>
          )}
        </div>
      </div>

      {/* Flash messages */}
      {actionData?.error && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-400">
          {actionData.error}
        </div>
      )}
      {actionData?.success && (
        <div className="rounded-md bg-green-50 dark:bg-green-900/20 p-3 text-sm text-green-700 dark:text-green-400">
          {actionData.success}
        </div>
      )}

      {/* Edit form */}
      <Form method="post" className="space-y-4">
        <input type="hidden" name="intent" value="update" />

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Name
          </label>
          <input
            type="text"
            name="name"
            defaultValue={connector.name}
            required
            className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Status
          </label>
          <select
            name="status"
            defaultValue={connector.status}
            className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {connector.type !== "upload" && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Sync Schedule
            </label>
            <select
              name="syncSchedule"
              defaultValue={connector.syncSchedule ?? ""}
              className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            >
              {SYNC_SCHEDULES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </Form>

      {/* Sync history */}
      {connector.type !== "upload" && (
        <section>
          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wider mb-3">
            Sync History
          </h4>
          {syncRuns.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No sync runs yet.
            </p>
          ) : (
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      Status
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      Created
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      Updated
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      Skipped
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      Started
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      Error
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                  {syncRuns.map((run) => (
                    <tr key={run.id}>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${RUN_STATUS_COLORS[run.status] ?? ""}`}
                        >
                          {run.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
                        {run.objectsCreated}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
                        {run.objectsUpdated}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
                        {run.objectsSkipped}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                        {new Date(run.startedAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-xs text-red-600 dark:text-red-400 max-w-xs truncate">
                        {run.error ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Danger zone */}
      <section className="border border-red-200 dark:border-red-800/50 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-red-700 dark:text-red-400 mb-2">
          Danger Zone
        </h4>
        {!showDelete ? (
          <button
            type="button"
            onClick={() => setShowDelete(true)}
            className="text-sm text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
          >
            Delete this connector...
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              This cannot be undone. Knowledge objects imported by this connector
              will remain.
            </p>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="delete" />
              <button
                type="submit"
                className="inline-flex items-center rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
              >
                Delete
              </button>
            </fetcher.Form>
            <button
              type="button"
              onClick={() => setShowDelete(false)}
              className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
            >
              Cancel
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
