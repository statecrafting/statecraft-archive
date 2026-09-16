import { Link, useLoaderData, useSearchParams } from "react-router";

import { tenants, type TenantView } from "../lib/api";
import { formatDate } from "../lib/ui";

export async function dashboardLoader() {
  const [{ tenants: list }, { url: installUrl }] = await Promise.all([
    tenants.list(),
    tenants.installUrlForUser(),
  ]);
  return { tenants: list, installUrl };
}

export function Dashboard() {
  const { tenants: list, installUrl } = useLoaderData() as {
    tenants: TenantView[];
    installUrl: string;
  };
  // GitHub's App-install flow redirects back to "/?github=installed&tenant=<id>"
  // (or github=error); surface the outcome rather than swallowing it.
  const [params] = useSearchParams();
  const github = params.get("github");
  const githubTenant = params.get("tenant");

  return (
    <section>
      {github === "installed" && (
        <div className="banner">
          GitHub App installed.{" "}
          {githubTenant && <Link to={`/tenants/${githubTenant}`}>Open the tenant</Link>}
        </div>
      )}
      {github === "error" && (
        <div className="banner bad">
          The GitHub App installation could not be verified. Try the install link again.
        </div>
      )}

      <div className="page-head">
        <h1>Tenants</h1>
        <div className="page-actions">
          <a className="btn" href={installUrl}>
            Install into a new org
          </a>
          <Link className="btn btn-primary" to="/tenants/new">
            New tenant
          </Link>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="card empty">
          <p>No tenants yet.</p>
          <p className="muted">
            A tenant is a customer GitHub org you install the statecraft App into. Stamped repos
            are born in that org. Installing the App creates the tenant for you (spec 011 §5.6);
            GitHub asks which org during the install.
          </p>
          <a className="btn btn-primary" href={installUrl}>
            Install the GitHub App
          </a>
          <Link className="btn" to="/tenants/new">
            Create an empty tenant instead
          </Link>
        </div>
      ) : (
        <ul className="tenant-list">
          {list.map((t) => (
            <li key={t.id} className="card tenant-row">
              <Link to={`/tenants/${t.id}`} className="tenant-name">
                {t.name}
              </Link>
              <span className="muted">created {formatDate(t.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
