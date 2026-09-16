import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import type { ActionFunctionArgs } from "react-router";

import { ApiError, tenants } from "../lib/api";

export async function tenantNewAction({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  if (!name) return { error: "Tenant name is required." };
  try {
    const tenant = await tenants.create(name);
    return redirect(`/tenants/${tenant.id}`);
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    throw err;
  }
}

export function TenantNew() {
  const actionData = useActionData() as { error?: string } | undefined;
  const nav = useNavigation();
  const busy = nav.state === "submitting";

  return (
    <section className="narrow">
      <p className="breadcrumb">
        <Link to="/">Tenants</Link> / new
      </p>
      <h1>New tenant</h1>
      <Form method="post" className="card form">
        <label className="field">
          <span>Tenant name</span>
          <input name="name" type="text" autoFocus placeholder="Acme Inc" required />
        </label>
        {actionData?.error && <p className="error">{actionData.error}</p>}
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "Creating..." : "Create tenant"}
          </button>
          <Link className="btn" to="/">
            Cancel
          </Link>
        </div>
      </Form>
    </section>
  );
}
