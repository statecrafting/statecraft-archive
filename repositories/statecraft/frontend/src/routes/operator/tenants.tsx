import { Link, redirect, useLoaderData } from "react-router";

import { ApiError, operator, type OperatorTenantView } from "../../lib/api";
import { formatDate, StatusBadge } from "../../lib/ui";

/**
 * The operator console (spec 011 §5.8): every tenant on this control plane, with
 * installation status, membership counts, and fleet app counts, and a drill-down
 * to the ordinary tenant page where an operator can run any lifecycle verb.
 * Server-side `statecraft_operator` enforcement is the truth; this route bounces
 * a non-operator who reaches it directly.
 */
interface OperatorTenantsData {
  tenants: OperatorTenantView[];
}

export async function operatorTenantsLoader(): Promise<OperatorTenantsData> {
  try {
    const { tenants } = await operator.tenants();
    return { tenants };
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      throw redirect("/");
    }
    throw err;
  }
}

export function OperatorTenants() {
  const { tenants } = useLoaderData() as OperatorTenantsData;

  return (
    <section>
      <div className="page-head">
        <h1>Operators</h1>
        <div className="btn-row">
          <Link className="btn btn-primary" to="/tenants/new">
            New tenant
          </Link>
        </div>
      </div>
      <p className="muted">
        Every tenant on this control plane. Open one to run any lifecycle action on it.
      </p>

      {tenants.length === 0 ? (
        <div className="card">
          <p className="muted">No tenants yet.</p>
        </div>
      ) : (
        <div className="card">
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>tenant</th>
                  <th>installation</th>
                  <th>members</th>
                  <th>fleet apps</th>
                  <th>created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td>
                      <StatusBadge status={t.installationStatus} />
                    </td>
                    <td>{t.memberCount}</td>
                    <td>{t.fleetAppCount}</td>
                    <td>{formatDate(t.createdAt)}</td>
                    <td>
                      <Link to={`/tenants/${t.id}`}>open</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
