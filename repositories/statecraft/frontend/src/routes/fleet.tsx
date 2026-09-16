import { useState } from "react";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import {
  ApiError,
  degradeOn404,
  fleet,
  isDegraded,
  tenants,
  type Degraded,
  type FleetAppView,
} from "../lib/api";
import { formatDate, StatusBadge } from "../lib/ui";

interface FleetData {
  tenantId: string;
  apps: FleetAppView[] | Degraded;
  hasActiveInstallation: boolean;
}

export async function fleetLoader({ params }: LoaderFunctionArgs): Promise<FleetData> {
  const tenantId = params.id as string;
  const apps = await degradeOn404(
    fleet.list(tenantId).then((r) => r.apps),
    "The fleet",
  );
  // Provisioning gates on an active installation (spec 011 §5.7). On any read
  // failure default to enabled: the server enforces the gate regardless.
  let hasActiveInstallation = true;
  try {
    const detail = await tenants.get(tenantId);
    hasActiveInstallation = detail.installations.some((i) => i.status === "active");
  } catch {
    hasActiveInstallation = true;
  }
  return { tenantId, apps, hasActiveInstallation };
}

export async function fleetAction({ params, request }: ActionFunctionArgs) {
  const tenantId = params.id as string;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  try {
    if (intent === "deploy") {
      const name = String(form.get("name") ?? "").trim();
      const image = String(form.get("image") ?? "").trim();
      const volumeSize = String(form.get("volumeSize") ?? "").trim();
      const host = String(form.get("host") ?? "").trim();
      if (!name || !image) return { error: "App name and image ref are required." };
      await fleet.deploy(tenantId, {
        name,
        image,
        ...(volumeSize ? { volumeSize } : {}),
        ...(host ? { host } : {}),
      });
    } else if (intent === "update") {
      const image = String(form.get("image") ?? "").trim();
      if (!image) return { error: "A new image ref is required to update." };
      await fleet.update(String(form.get("appId") ?? ""), image);
    } else if (intent === "backup") {
      await fleet.backup(String(form.get("appId") ?? ""));
    } else if (intent === "remove") {
      const name = String(form.get("name") ?? "");
      const confirm = String(form.get("confirm") ?? "");
      if (confirm !== name) {
        return { error: `Type the app name "${name}" exactly to confirm removal.` };
      }
      await fleet.remove(String(form.get("appId") ?? ""), confirm);
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    throw err;
  }
}

export function Fleet() {
  const { tenantId, apps, hasActiveInstallation } = useLoaderData() as FleetData;
  const actionData = useActionData() as { error?: string; ok?: boolean } | undefined;

  return (
    <section>
      <p className="breadcrumb">
        <Link to="/">Tenants</Link> / <Link to={`/tenants/${tenantId}`}>tenant</Link> / fleet
      </p>
      <h1>Fleet</h1>

      {actionData?.error && <div className="banner bad">{actionData.error}</div>}

      {isDegraded(apps) ? (
        <div className="notice">
          {apps.reason} The fleet service (spec 006) operates stamped apps on the cluster; this view
          lights up once it is deployed.
        </div>
      ) : (
        <>
          {apps.length === 0 ? (
            <div className="card">
              <p className="muted">No apps placed for this tenant yet.</p>
            </div>
          ) : (
            <div className="card">
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>app</th>
                      <th>status</th>
                      <th>host</th>
                      <th>image</th>
                      <th>updated</th>
                      <th>operations</th>
                    </tr>
                  </thead>
                  <tbody>
                    {apps.map((app) => (
                      <tr key={app.id}>
                        <td>{app.name}</td>
                        <td>
                          <StatusBadge status={app.status} />
                        </td>
                        <td>
                          {app.host ? (
                            <a href={`https://${app.host}`} target="_blank" rel="noreferrer">
                              {app.host}
                            </a>
                          ) : (
                            <span className="muted">n/a</span>
                          )}
                        </td>
                        <td>
                          <code>{app.image}</code>
                        </td>
                        <td>{formatDate(app.updatedAt)}</td>
                        <td>
                          <AppOps app={app} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <h2 className="section-title">Deploy an app</h2>
          <DeployForm enabled={hasActiveInstallation} />
        </>
      )}
    </section>
  );
}

function DeployForm({ enabled }: { enabled: boolean }) {
  const nav = useNavigation();
  const busy = nav.state === "submitting";
  return (
    <Form method="post" className="card form">
      <input type="hidden" name="intent" value="deploy" />
      {!enabled && (
        <div className="notice">
          Deploying is disabled until this tenant has an active GitHub App installation.
        </div>
      )}
      <label className="field">
        <span>App name</span>
        <input name="name" type="text" placeholder="my-app" required disabled={!enabled} />
      </label>
      <label className="field">
        <span>Image ref</span>
        <input
          name="image"
          type="text"
          placeholder="registry.example.com/my-app:sha-abc123"
          required
          disabled={!enabled}
        />
      </label>
      <label className="field">
        <span>Volume size (optional)</span>
        <input name="volumeSize" type="text" placeholder="1Gi" disabled={!enabled} />
      </label>
      <label className="field">
        <span>Host (optional)</span>
        <input name="host" type="text" placeholder="my-app.fleet.example.com" disabled={!enabled} />
      </label>
      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={busy || !enabled}>
          {busy ? "Placing..." : "Deploy"}
        </button>
      </div>
    </Form>
  );
}

function AppOps({ app }: { app: FleetAppView }) {
  const [mode, setMode] = useState<"idle" | "update" | "remove">("idle");
  const [confirm, setConfirm] = useState("");
  const [image, setImage] = useState("");
  const nav = useNavigation();
  const busy = nav.state === "submitting";

  if (mode === "update") {
    return (
      <Form method="post" className="inline-form">
        <input type="hidden" name="intent" value="update" />
        <input type="hidden" name="appId" value={app.id} />
        <input
          name="image"
          type="text"
          placeholder="new image ref"
          value={image}
          onChange={(e) => setImage(e.target.value)}
          required
        />
        <button className="btn btn-primary" type="submit" disabled={busy || !image.trim()}>
          Apply
        </button>
        <button className="btn" type="button" onClick={() => setMode("idle")}>
          Cancel
        </button>
      </Form>
    );
  }

  if (mode === "remove") {
    return (
      <Form method="post" className="inline-form">
        <input type="hidden" name="intent" value="remove" />
        <input type="hidden" name="appId" value={app.id} />
        <input type="hidden" name="name" value={app.name} />
        {/* Destructive-op guard surfaced honestly: the operator must retype the
            exact app name; the backend enforces the same confirm on removeApp. */}
        <input
          name="confirm"
          type="text"
          placeholder={`type "${app.name}"`}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-label={`Type ${app.name} to confirm removal`}
        />
        <button
          className="btn btn-danger"
          type="submit"
          disabled={busy || confirm !== app.name}
        >
          Remove
        </button>
        <button className="btn" type="button" onClick={() => setMode("idle")}>
          Cancel
        </button>
      </Form>
    );
  }

  return (
    <div className="btn-row">
      <button className="btn" type="button" onClick={() => setMode("update")}>
        Update
      </button>
      <Form method="post" style={{ display: "inline" }}>
        <input type="hidden" name="intent" value="backup" />
        <input type="hidden" name="appId" value={app.id} />
        <button className="btn" type="submit" disabled={busy}>
          Backup
        </button>
      </Form>
      <button className="btn btn-danger" type="button" onClick={() => setMode("remove")}>
        Remove
      </button>
    </div>
  );
}
