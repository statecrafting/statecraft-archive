import { Form, redirect, useActionData, useNavigation, useParams } from "react-router";
import { requireUser } from "../lib/auth.server";
import { createConnector } from "../lib/project-api.server";
import { useState } from "react";

export async function action({
  request,
  params,
}: {
  request: Request;
  params: { projectId: string };
}) {
  await requireUser(request);
  const form = await request.formData();

  const type = form.get("type") as string;
  const name = form.get("name") as string;
  const syncSchedule = (form.get("syncSchedule") as string) || undefined;

  // Build type-specific config
  const config: Record<string, unknown> = {};

  if (type === "sharepoint") {
    config.tenantId = form.get("tenantId") as string;
    config.clientId = form.get("clientId") as string;
    config.clientSecret = form.get("clientSecret") as string;
    config.siteUrl = form.get("siteUrl") as string;
    const driveId = form.get("driveId") as string;
    const folderPath = form.get("folderPath") as string;
    if (driveId) config.driveId = driveId;
    if (folderPath) config.folderPath = folderPath;
  } else if (type === "s3") {
    config.bucket = form.get("s3Bucket") as string;
    config.prefix = form.get("s3Prefix") as string;
    config.region = form.get("s3Region") as string;
    config.accessKeyId = form.get("s3AccessKeyId") as string;
    config.secretAccessKey = form.get("s3SecretAccessKey") as string;
  } else if (type === "azure-blob") {
    config.connectionString = form.get("azureConnectionString") as string;
    config.container = form.get("azureContainer") as string;
    config.prefix = form.get("azurePrefix") as string;
  } else if (type === "gcs") {
    config.bucket = form.get("gcsBucket") as string;
    config.prefix = form.get("gcsPrefix") as string;
    config.serviceAccountKey = form.get("gcsServiceAccountKey") as string;
  }

  try {
    await createConnector(request, params.projectId, {
      type,
      name,
      config: Object.keys(config).length > 0 ? config : undefined,
      syncSchedule,
    });
    return redirect(`/app/project/${params.projectId}/settings/connectors`);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to create connector",
    };
  }
}

const CONNECTOR_TYPES = [
  { value: "sharepoint", label: "SharePoint Online", hasConfig: true },
  { value: "s3", label: "Amazon S3", hasConfig: true },
  { value: "azure-blob", label: "Azure Blob Storage", hasConfig: true },
  { value: "gcs", label: "Google Cloud Storage", hasConfig: true },
  { value: "upload", label: "Direct Upload", hasConfig: false },
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

export default function NewConnector() {
  const actionData = useActionData() as { error?: string } | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const [selectedType, setSelectedType] = useState("sharepoint");
  const { projectId } = useParams() as { projectId: string };

  return (
    <div className="max-w-2xl">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wider mb-4">
        Add Connector
      </h3>

      {actionData?.error && (
        <div className="mb-4 rounded-md bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-400">
          {actionData.error}
        </div>
      )}

      <Form method="post" className="space-y-6">
        {/* Connector type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Type
          </label>
          <select
            name="type"
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            {CONNECTOR_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Name
          </label>
          <input
            type="text"
            name="name"
            required
            placeholder="e.g. Product Docs SharePoint"
            className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>

        {/* Sync schedule (not for upload) */}
        {selectedType !== "upload" && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Sync Schedule
            </label>
            <select
              name="syncSchedule"
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

        {/* SharePoint config */}
        {selectedType === "sharepoint" && (
          <fieldset className="space-y-4 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <legend className="text-sm font-medium text-gray-700 dark:text-gray-300 px-1">
              SharePoint Configuration
            </legend>
            <ConfigInput name="tenantId" label="Azure AD Tenant ID" required placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
            <ConfigInput name="clientId" label="App Client ID" required placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
            <ConfigInput name="clientSecret" label="App Client Secret" required type="password" />
            <ConfigInput name="siteUrl" label="Site URL" required placeholder="https://contoso.sharepoint.com/sites/docs" />
            <ConfigInput name="driveId" label="Drive ID" placeholder="Optional — defaults to root document library" />
            <ConfigInput name="folderPath" label="Folder Path" placeholder="Optional — e.g. /General/Specs" />
          </fieldset>
        )}

        {/* S3 config */}
        {selectedType === "s3" && (
          <fieldset className="space-y-4 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <legend className="text-sm font-medium text-gray-700 dark:text-gray-300 px-1">
              S3 Configuration
            </legend>
            <ConfigInput name="s3Bucket" label="Bucket" required placeholder="my-docs-bucket" />
            <ConfigInput name="s3Prefix" label="Prefix" placeholder="Optional — e.g. documents/" />
            <ConfigInput name="s3Region" label="Region" required placeholder="us-east-1" />
            <ConfigInput name="s3AccessKeyId" label="Access Key ID" required />
            <ConfigInput name="s3SecretAccessKey" label="Secret Access Key" required type="password" />
          </fieldset>
        )}

        {/* Azure Blob config */}
        {selectedType === "azure-blob" && (
          <fieldset className="space-y-4 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <legend className="text-sm font-medium text-gray-700 dark:text-gray-300 px-1">
              Azure Blob Configuration
            </legend>
            <ConfigInput name="azureConnectionString" label="Connection String" required type="password" />
            <ConfigInput name="azureContainer" label="Container" required placeholder="documents" />
            <ConfigInput name="azurePrefix" label="Prefix" placeholder="Optional — e.g. intake/" />
          </fieldset>
        )}

        {/* GCS config */}
        {selectedType === "gcs" && (
          <fieldset className="space-y-4 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <legend className="text-sm font-medium text-gray-700 dark:text-gray-300 px-1">
              Google Cloud Storage Configuration
            </legend>
            <ConfigInput name="gcsBucket" label="Bucket" required placeholder="my-docs-bucket" />
            <ConfigInput name="gcsPrefix" label="Prefix" placeholder="Optional — e.g. documents/" />
            <ConfigInput name="gcsServiceAccountKey" label="Service Account Key (JSON)" required type="password" />
          </fieldset>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Creating..." : "Create Connector"}
          </button>
          <a
            href={`/app/project/${projectId}/settings/connectors`}
            className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
          >
            Cancel
          </a>
        </div>
      </Form>
    </div>
  );
}

function ConfigInput({
  name,
  label,
  required,
  type = "text",
  placeholder,
}: {
  name: string;
  label: string;
  required?: boolean;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        type={type}
        name={name}
        required={required}
        placeholder={placeholder}
        className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
      />
    </div>
  );
}
