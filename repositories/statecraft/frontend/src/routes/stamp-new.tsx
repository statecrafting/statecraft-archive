import { Form, Link, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { ApiError, factory, tenants, type Posture, type TenantView } from "../lib/api";

interface StampNewData {
  tenant: TenantView;
  orgs: string[];
}

export async function stampNewLoader({ params }: LoaderFunctionArgs): Promise<StampNewData> {
  const id = params.id as string;
  const detail = await tenants.get(id);
  const orgs = detail.installations
    .filter((i) => i.status === "active")
    .map((i) => i.githubOrg);
  return { tenant: detail.tenant, orgs };
}

function isPosture(value: string): value is Posture {
  return value === "none" || value === "assisted" || value === "autonomous";
}

export async function stampNewAction({ params, request }: ActionFunctionArgs) {
  const id = params.id as string;
  const form = await request.formData();
  const appName = String(form.get("appName") ?? "").trim();
  const targetOrg = String(form.get("targetOrg") ?? "").trim();
  const posture = String(form.get("posture") ?? "");
  const frontend = String(form.get("frontend") ?? "").trim();

  if (!appName || !targetOrg) return { error: "App name and target org are required." };
  if (!isPosture(posture)) return { error: "Select an agentic posture." };

  try {
    const job = await factory.launch(id, {
      appName,
      targetOrg,
      posture,
      ...(frontend ? { frontend } : {}),
    });
    return redirect(`/stamps/${job.id}`);
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    throw err;
  }
}

export function StampNew() {
  const { tenant, orgs } = useLoaderData() as StampNewData;
  const actionData = useActionData() as { error?: string } | undefined;
  const nav = useNavigation();
  const busy = nav.state === "submitting";

  return (
    <section className="narrow">
      <p className="breadcrumb">
        <Link to="/">Tenants</Link> / <Link to={`/tenants/${tenant.id}`}>{tenant.name}</Link> /
        stamp
      </p>
      <h1>Stamp an app</h1>

      {orgs.length === 0 ? (
        <div className="card empty">
          <p>No active GitHub installation.</p>
          <p className="muted">
            The factory stamps into an org the statecraft App is installed in. Install it first.
          </p>
          <Link className="btn btn-primary" to={`/tenants/${tenant.id}`}>
            Back to tenant
          </Link>
        </div>
      ) : (
        <Form method="post" className="card form">
          <label className="field">
            <span>App name</span>
            <input name="appName" type="text" autoFocus placeholder="my-app" required />
          </label>

          <label className="field">
            <span>Target org</span>
            <select name="targetOrg" required defaultValue={orgs.length === 1 ? orgs[0] : ""}>
              {orgs.length !== 1 && (
                <option value="" disabled>
                  Select an org...
                </option>
              )}
              {orgs.map((org) => (
                <option key={org} value={org}>
                  {org}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Frontend flavor (optional)</span>
            <select name="frontend" defaultValue="">
              <option value="">Template default</option>
              <option value="react">react</option>
              <option value="vue">vue</option>
              <option value="none">none (API only)</option>
            </select>
            <span className="hint">
              The factory currently applies the template contract&apos;s default flavor; explicit
              selection is recorded but not yet consumed (spec 005).
            </span>
          </label>

          {/* REQUIRED, no preselected value: the empty placeholder is disabled, so
              native validation blocks submission until the operator chooses, and
              the factory rejects anything but none|assisted|autonomous. */}
          <label className="field">
            <span>Agentic posture</span>
            <select name="posture" required defaultValue="">
              <option value="" disabled>
                Select agentic posture...
              </option>
              <option value="none">none: no agent access</option>
              <option value="assisted">assisted: agent proposes, human approves</option>
              <option value="autonomous">autonomous: agent acts under governance</option>
            </select>
          </label>

          {actionData?.error && <p className="error">{actionData.error}</p>}
          <div className="form-actions">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? "Launching..." : "Launch stamp"}
            </button>
            <Link className="btn" to={`/tenants/${tenant.id}`}>
              Cancel
            </Link>
          </div>
        </Form>
      )}
    </section>
  );
}
