import { useLoaderData, Link, useFetcher, useParams } from "react-router";
import { requireUser } from "../lib/auth.server";
import {
  listConnectors,
  deleteConnector,
  triggerSync,
} from "../lib/project-api.server";
import type { SourceConnectorRow } from "../lib/project-api.server";

export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { projectId: string };
}) {
  await requireUser(request);
  const res = await listConnectors(request, params.projectId).catch(() => ({
    connectors: [] as SourceConnectorRow[],
  }));
  return { connectors: res.connectors };
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

  if (intent === "delete") {
    const id = form.get("connectorId") as string;
    await deleteConnector(request, params.projectId, id);
    return { deleted: true };
  }

  if (intent === "sync") {
    const id = form.get("connectorId") as string;
    const res = await triggerSync(request, params.projectId, id);
    return { syncRunId: res.syncRunId };
  }

  return null;
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  paused: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  error: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  disabled: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400",
};

const TYPE_LABELS: Record<string, string> = {
  upload: "Direct Upload",
  sharepoint: "SharePoint Online",
  s3: "Amazon S3",
  "azure-blob": "Azure Blob Storage",
  gcs: "Google Cloud Storage",
};

export default function ConnectorList() {
  const { connectors } = useLoaderData() as {
    connectors: SourceConnectorRow[];
  };
  const fetcher = useFetcher();
  const { projectId } = useParams() as { projectId: string };
  const base = `/app/project/${projectId}/settings/connectors`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wider">
          Source Connectors
        </h3>
        <Link
          to={`${base}/new`}
          className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Add Connector
        </Link>
      </div>

      {connectors.length === 0 ? (
        <div className="border border-dashed border-gray-300 dark:border-gray-600 rounded-lg px-4 py-12 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
            No connectors configured.
          </p>
          <p className="text-sm text-gray-400 dark:text-gray-500">
            Add a connector to import documents from external sources into this
            project's knowledge base.
          </p>
        </div>
      ) : (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden divide-y divide-gray-200 dark:divide-gray-700">
          {connectors.map((c) => (
            <div
              key={c.id}
              className="px-4 py-4 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Link
                    to={`${base}/${c.id}`}
                    className="text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-indigo-600 dark:hover:text-indigo-400"
                  >
                    {c.name}
                  </Link>
                  <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">
                    {TYPE_LABELS[c.type] ?? c.type}
                  </span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[c.status] ?? ""}`}
                  >
                    {c.status}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {c.type !== "upload" && c.status === "active" && (
                    <fetcher.Form method="post">
                      <input type="hidden" name="intent" value="sync" />
                      <input type="hidden" name="connectorId" value={c.id} />
                      <button
                        type="submit"
                        className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium"
                      >
                        Sync now
                      </button>
                    </fetcher.Form>
                  )}
                  <Link
                    to={`${base}/${c.id}`}
                    className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                  >
                    Configure
                  </Link>
                </div>
              </div>

              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {c.syncSchedule && (
                  <span>Sync schedule: {c.syncSchedule}</span>
                )}
                {c.lastSyncedAt && (
                  <span>
                    {c.syncSchedule ? " · " : ""}Last sync:{" "}
                    {new Date(c.lastSyncedAt).toLocaleString()}
                  </span>
                )}
                {!c.syncSchedule && !c.lastSyncedAt && c.type !== "upload" && (
                  <span className="text-gray-400 dark:text-gray-500">
                    No sync schedule — trigger manually or set a schedule
                  </span>
                )}
                {c.type === "upload" && (
                  <span className="text-gray-400 dark:text-gray-500">
                    User-initiated uploads — no sync required
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
