import { useState } from "react";
import { Form, Link, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import {
  ApiError,
  degradeOn404,
  factory,
  isDegraded,
  tenants,
  type Degraded,
  type InstallationView,
  type RepoView,
  type StampJobView,
  type TenantView,
} from "../lib/api";
import { formatDate, StatusBadge } from "../lib/ui";

interface TenantDetailData {
  tenant: TenantView;
  installations: InstallationView[];
  installUrl: string;
  repos: RepoView[] | null; // null when there is no active installation (412)
  stamps: StampJobView[] | Degraded;
}

export async function tenantDetailLoader({ params }: LoaderFunctionArgs): Promise<TenantDetailData> {
  const id = params.id as string;
  const detail = await tenants.get(id);
  const { url } = await tenants.installUrl(id);

  const hasActive = detail.installations.some((i) => i.status === "active");
  let repos: RepoView[] | null = null;
  if (hasActive) {
    try {
      repos = (await tenants.repos(id)).repos;
    } catch {
      // 412 (no active installation) or a transient repo-fetch failure: the
      // repos panel simply stays empty rather than failing the whole page.
      repos = null;
    }
  }

  const stamps = await degradeOn404(
    factory.list(id).then((r) => r.stamps),
    "The factory",
  );

  return { tenant: detail.tenant, installations: detail.installations, installUrl: url, repos, stamps };
}

/** Lifecycle exits (spec 011 §5.4 uninstall, §5.5 delete). */
export async function tenantDetailAction({ params, request }: ActionFunctionArgs) {
  const id = params.id as string;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  try {
    if (intent === "uninstall") {
      await tenants.uninstall(id);
      return { ok: "The GitHub App was uninstalled. Stamp and deploy are disabled until you reinstall." };
    }
    if (intent === "delete") {
      const confirm = String(form.get("confirm") ?? "");
      if (confirm !== String(form.get("name") ?? "")) {
        return { error: "Type the tenant name exactly to confirm deletion." };
      }
      await tenants.remove(id, confirm);
      return redirect("/");
    }
    return { error: "Unknown action." };
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    throw err;
  }
}

export function TenantDetail() {
  const { tenant, installations, installUrl, repos, stamps } =
    useLoaderData() as TenantDetailData;
  const actionData = useActionData() as { error?: string; ok?: string } | undefined;
  const nav = useNavigation();
  const busy = nav.state === "submitting";
  const hasActive = installations.some((i) => i.status === "active");

  const [unlinking, setUnlinking] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  return (
    <section>
      <p className="breadcrumb">
        <Link to="/">Tenants</Link> / {tenant.name}
      </p>
      <div className="page-head">
        <h1>{tenant.name}</h1>
        <div className="btn-row">
          {hasActive ? (
            <Link className="btn btn-primary" to={`/tenants/${tenant.id}/stamps/new`}>
              Stamp an app
            </Link>
          ) : (
            <button
              className="btn btn-primary"
              type="button"
              disabled
              title="Install the GitHub App into an org before stamping"
            >
              Stamp an app
            </button>
          )}
          {/* Fleet stays reachable when unlinked so existing apps can be removed;
              provisioning (deploy) is gated on the fleet page and server-side. */}
          <Link className="btn" to={`/tenants/${tenant.id}/fleet`}>
            Fleet
          </Link>
        </div>
      </div>

      {actionData?.error && <div className="banner bad">{actionData.error}</div>}
      {actionData?.ok && <div className="banner">{actionData.ok}</div>}
      {!hasActive && (
        <div className="notice">
          No active GitHub App installation. Stamp and deploy are disabled until you install the App.
        </div>
      )}

      <div className="card">
        <dl className="kv">
          <dt>tenant id</dt>
          <dd>
            <code>{tenant.id}</code>
          </dd>
          <dt>created</dt>
          <dd>{formatDate(tenant.createdAt)}</dd>
        </dl>
      </div>

      <h2 className="section-title">GitHub installations</h2>
      {installations.length === 0 ? (
        <div className="card empty">
          <p>No GitHub App installation yet.</p>
          <p className="muted">
            Install the statecraft App into your GitHub org so the factory can stamp repos into it.
            Nobody joins our org; your code stays in yours.
          </p>
          {/* Full-page navigation to GitHub; it redirects back to "/?github=installed". */}
          <a className="btn btn-primary" href={installUrl}>
            Install the statecraft App
          </a>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>org</th>
                    <th>status</th>
                    <th>installation id</th>
                    <th>added</th>
                  </tr>
                </thead>
                <tbody>
                  {installations.map((inst) => (
                    <tr key={inst.id}>
                      <td>{inst.githubOrg}</td>
                      <td>
                        <StatusBadge status={inst.status} />
                      </td>
                      <td>
                        <code>{inst.installationId}</code>
                      </td>
                      <td>{formatDate(inst.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="hint">
            <a href={installUrl}>Install into another org</a>
          </p>
          {hasActive && (
            <div className="card">
              {!unlinking ? (
                <button className="btn btn-danger" type="button" onClick={() => setUnlinking(true)}>
                  Unlink GitHub App
                </button>
              ) : (
                <Form method="post" className="inline-form">
                  <input type="hidden" name="intent" value="uninstall" />
                  <span className="muted">
                    Uninstall the App on GitHub? Reinstalling re-enables stamp and deploy.
                  </span>
                  <button className="btn btn-danger" type="submit" disabled={busy}>
                    Confirm unlink
                  </button>
                  <button className="btn" type="button" onClick={() => setUnlinking(false)}>
                    Cancel
                  </button>
                </Form>
              )}
            </div>
          )}
        </>
      )}

      {hasActive && (
        <>
          <h2 className="section-title">Repositories</h2>
          <div className="card">
            {repos === null ? (
              <p className="muted">Repositories are unavailable for this installation right now.</p>
            ) : repos.length === 0 ? (
              <p className="muted">No repositories visible to the installation yet.</p>
            ) : (
              <ul className="tenant-list">
                {repos.map((repo) => (
                  <li key={repo.id} className="tenant-row">
                    <a href={repo.htmlUrl} target="_blank" rel="noreferrer">
                      {repo.fullName}
                    </a>
                    {repo.private && <span className="badge badge-muted">private</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <h2 className="section-title">Recent stamps</h2>
      {isDegraded(stamps) ? (
        <div className="notice">{stamps.reason}</div>
      ) : stamps.length === 0 ? (
        <div className="card">
          <p className="muted">No stamp jobs yet.</p>
        </div>
      ) : (
        <div className="card">
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>app</th>
                  <th>org</th>
                  <th>posture</th>
                  <th>status</th>
                  <th>started</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {stamps.map((job) => (
                  <tr key={job.id}>
                    <td>{job.appName}</td>
                    <td>{job.org}</td>
                    <td>{job.posture}</td>
                    <td>
                      <StatusBadge status={job.status} />
                    </td>
                    <td>{formatDate(job.createdAt)}</td>
                    <td>
                      <Link to={`/stamps/${job.id}`}>view</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <h2 className="section-title">Danger zone</h2>
      <div className="card">
        <p className="muted">
          Deleting a tenant uninstalls the GitHub App, removes every membership, and cannot be
          undone. Remove any fleet apps first.
        </p>
        <Form method="post" className="inline-form">
          <input type="hidden" name="intent" value="delete" />
          <input type="hidden" name="name" value={tenant.name} />
          <input
            name="confirm"
            type="text"
            placeholder={`type "${tenant.name}"`}
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            aria-label={`Type ${tenant.name} to confirm deletion`}
            autoComplete="off"
          />
          <button
            className="btn btn-danger"
            type="submit"
            disabled={busy || deleteConfirm !== tenant.name}
          >
            Delete tenant
          </button>
        </Form>
      </div>
    </section>
  );
}
