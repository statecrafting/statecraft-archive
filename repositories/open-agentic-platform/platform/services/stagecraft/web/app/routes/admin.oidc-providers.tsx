import { useState, useEffect } from "react";
import { useLoaderData } from "react-router";
import { requireAdmin } from "../lib/auth.server";
import { getCookieToken } from "../lib/auth.server";

interface OidcProvider {
  id: string;
  orgId: string;
  name: string;
  providerType: string;
  issuer: string;
  clientId: string;
  scopes: string;
  claimsMapping: Record<string, string>;
  emailDomain: string | null;
  autoProvision: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface GroupMapping {
  id: string;
  orgId: string;
  providerId: string;
  idpGroupId: string;
  idpGroupName: string | null;
  targetScope: "org" | "project";
  targetId: string | null;
  role: string;
  createdAt: string;
}

export async function loader({ request }: { request: Request }) {
  const admin = await requireAdmin(request);
  return { orgId: admin.orgId, token: getCookieToken(request, "admin") };
}

export default function AdminOidcProviders() {
  const { orgId, token } = useLoaderData() as {
    orgId: string;
    token: string | undefined;
  };

  const [providers, setProviders] = useState<OidcProvider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [mappings, setMappings] = useState<GroupMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New provider form
  const [showCreate, setShowCreate] = useState(false);
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState("oidc");
  const [formIssuer, setFormIssuer] = useState("");
  const [formClientId, setFormClientId] = useState("");
  const [formClientSecret, setFormClientSecret] = useState("");
  const [formEmailDomain, setFormEmailDomain] = useState("");
  const [formAutoProvision, setFormAutoProvision] = useState(true);

  // New mapping form
  const [showCreateMapping, setShowCreateMapping] = useState(false);
  const [mapGroupId, setMapGroupId] = useState("");
  const [mapGroupName, setMapGroupName] = useState("");
  const [mapScope, setMapScope] = useState<"org" | "project">("org");
  const [mapRole, setMapRole] = useState("member");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["Cookie"] = `__session=${token}`;

  async function fetchProviders() {
    try {
      setLoading(true);
      const resp = await fetch(
        `/admin/orgs/${orgId}/oidc-providers`,
        { headers }
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setProviders(data.providers);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function fetchMappings(providerId: string) {
    try {
      const resp = await fetch(
        `/admin/orgs/${orgId}/oidc-providers/${providerId}/group-mappings`,
        { headers }
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setMappings(data.mappings);
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    fetchProviders();
  }, [orgId]);

  useEffect(() => {
    if (selectedProvider) fetchMappings(selectedProvider);
    else setMappings([]);
  }, [selectedProvider]);

  async function handleCreateProvider(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const resp = await fetch(`/admin/orgs/${orgId}/oidc-providers`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          orgId,
          name: formName,
          providerType: formType,
          issuer: formIssuer,
          clientId: formClientId,
          clientSecretEnc: formClientSecret,
          emailDomain: formEmailDomain || undefined,
          autoProvision: formAutoProvision,
        }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${resp.status}`);
      }
      setShowCreate(false);
      setFormName("");
      setFormType("oidc");
      setFormIssuer("");
      setFormClientId("");
      setFormClientSecret("");
      setFormEmailDomain("");
      setFormAutoProvision(true);
      await fetchProviders();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleDeleteProvider(id: string) {
    if (!confirm("Delete this OIDC provider? All group mappings will also be removed.")) return;
    try {
      const resp = await fetch(`/admin/orgs/${orgId}/oidc-providers/${id}`, {
        method: "DELETE",
        headers,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      if (selectedProvider === id) setSelectedProvider(null);
      await fetchProviders();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleToggleStatus(provider: OidcProvider) {
    const newStatus = provider.status === "active" ? "disabled" : "active";
    try {
      const resp = await fetch(
        `/admin/orgs/${orgId}/oidc-providers/${provider.id}`,
        {
          method: "PUT",
          headers,
          body: JSON.stringify({ orgId, id: provider.id, status: newStatus }),
        }
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      await fetchProviders();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleCreateMapping(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedProvider) return;
    setError(null);
    try {
      const resp = await fetch(
        `/admin/orgs/${orgId}/oidc-providers/${selectedProvider}/group-mappings`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            orgId,
            providerId: selectedProvider,
            idpGroupId: mapGroupId,
            idpGroupName: mapGroupName || undefined,
            targetScope: mapScope,
            role: mapRole,
          }),
        }
      );
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${resp.status}`);
      }
      setShowCreateMapping(false);
      setMapGroupId("");
      setMapGroupName("");
      setMapScope("org");
      setMapRole("member");
      await fetchMappings(selectedProvider);
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleDeleteMapping(mappingId: string) {
    if (!selectedProvider) return;
    try {
      const resp = await fetch(
        `/admin/orgs/${orgId}/oidc-providers/${selectedProvider}/group-mappings/${mappingId}`,
        { method: "DELETE", headers }
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      await fetchMappings(selectedProvider);
    } catch (err) {
      setError(String(err));
    }
  }

  if (loading) {
    return <div className="text-gray-500">Loading OIDC providers...</div>;
  }

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
      disabled: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
      pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    };
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[status] ?? colors.pending}`}>
        {status}
      </span>
    );
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
          OIDC Providers
        </h3>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          {showCreate ? "Cancel" : "Add Provider"}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {showCreate && (
        <form onSubmit={handleCreateProvider} className="mb-6 p-4 border border-gray-200 dark:border-gray-700 rounded space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm text-gray-600 dark:text-gray-400">Name</span>
              <input required value={formName} onChange={(e) => setFormName(e.target.value)}
                className="mt-1 block w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm" />
            </label>
            <label className="block">
              <span className="text-sm text-gray-600 dark:text-gray-400">Type</span>
              <select value={formType} onChange={(e) => setFormType(e.target.value)}
                className="mt-1 block w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm">
                <option value="oidc">Generic OIDC</option>
                <option value="azure-ad">Azure AD</option>
                <option value="okta">Okta</option>
                <option value="google-workspace">Google Workspace</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm text-gray-600 dark:text-gray-400">Issuer URL</span>
              <input required value={formIssuer} onChange={(e) => setFormIssuer(e.target.value)} placeholder="https://login.microsoftonline.com/..."
                className="mt-1 block w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm" />
            </label>
            <label className="block">
              <span className="text-sm text-gray-600 dark:text-gray-400">Client ID</span>
              <input required value={formClientId} onChange={(e) => setFormClientId(e.target.value)}
                className="mt-1 block w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm" />
            </label>
            <label className="block">
              <span className="text-sm text-gray-600 dark:text-gray-400">Client Secret</span>
              <input required type="password" value={formClientSecret} onChange={(e) => setFormClientSecret(e.target.value)}
                className="mt-1 block w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm" />
            </label>
            <label className="block">
              <span className="text-sm text-gray-600 dark:text-gray-400">Email Domain (routing)</span>
              <input value={formEmailDomain} onChange={(e) => setFormEmailDomain(e.target.value)} placeholder="company.com"
                className="mt-1 block w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm" />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <input type="checkbox" checked={formAutoProvision} onChange={(e) => setFormAutoProvision(e.target.checked)} />
            Auto-provision new users on first login (JIT)
          </label>
          <button type="submit" className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
            Create Provider
          </button>
        </form>
      )}

      {providers.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No OIDC providers configured. Add one to enable enterprise SSO.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <th className="py-2 font-medium">Name</th>
              <th className="py-2 font-medium">Type</th>
              <th className="py-2 font-medium">Issuer</th>
              <th className="py-2 font-medium">Domain</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((p) => (
              <tr
                key={p.id}
                className={`border-b border-gray-100 dark:border-gray-800 ${
                  selectedProvider === p.id ? "bg-blue-50 dark:bg-blue-900/20" : ""
                }`}
              >
                <td className="py-2">
                  <button
                    onClick={() => setSelectedProvider(selectedProvider === p.id ? null : p.id)}
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {p.name}
                  </button>
                </td>
                <td className="py-2 text-gray-600 dark:text-gray-400">{p.providerType}</td>
                <td className="py-2 text-gray-600 dark:text-gray-400 max-w-xs truncate">{p.issuer}</td>
                <td className="py-2 text-gray-600 dark:text-gray-400">{p.emailDomain ?? "—"}</td>
                <td className="py-2">{statusBadge(p.status)}</td>
                <td className="py-2 space-x-2">
                  <button
                    onClick={() => handleToggleStatus(p)}
                    className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  >
                    {p.status === "active" ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={() => handleDeleteProvider(p.id)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selectedProvider && (
        <div className="mt-6 border-t border-gray-200 dark:border-gray-700 pt-4">
          <div className="flex justify-between items-center mb-3">
            <h4 className="text-md font-medium text-gray-900 dark:text-gray-100">
              Group-to-Role Mappings
            </h4>
            <button
              onClick={() => setShowCreateMapping(!showCreateMapping)}
              className="px-3 py-1 text-xs bg-gray-600 text-white rounded hover:bg-gray-700"
            >
              {showCreateMapping ? "Cancel" : "Add Mapping"}
            </button>
          </div>

          {showCreateMapping && (
            <form onSubmit={handleCreateMapping} className="mb-4 p-3 border border-gray-200 dark:border-gray-700 rounded space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-xs text-gray-600 dark:text-gray-400">IdP Group ID</span>
                  <input required value={mapGroupId} onChange={(e) => setMapGroupId(e.target.value)}
                    className="mt-1 block w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm" />
                </label>
                <label className="block">
                  <span className="text-xs text-gray-600 dark:text-gray-400">Group Name (display)</span>
                  <input value={mapGroupName} onChange={(e) => setMapGroupName(e.target.value)}
                    className="mt-1 block w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm" />
                </label>
                <label className="block">
                  <span className="text-xs text-gray-600 dark:text-gray-400">Scope</span>
                  <select value={mapScope} onChange={(e) => setMapScope(e.target.value as "org" | "project")}
                    className="mt-1 block w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm">
                    <option value="org">Organization</option>
                    <option value="project">Project</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-gray-600 dark:text-gray-400">Role</span>
                  <select value={mapRole} onChange={(e) => setMapRole(e.target.value)}
                    className="mt-1 block w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm">
                    {mapScope === "org" ? (
                      <>
                        <option value="member">member</option>
                        <option value="admin">admin</option>
                        <option value="owner">owner</option>
                      </>
                    ) : (
                      <>
                        <option value="viewer">viewer</option>
                        <option value="developer">developer</option>
                        <option value="deployer">deployer</option>
                        <option value="admin">admin</option>
                      </>
                    )}
                  </select>
                </label>
              </div>
              <button type="submit" className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">
                Create Mapping
              </button>
            </form>
          )}

          {mappings.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No group mappings. Users logging in via this provider will get the default &quot;member&quot; role.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-1 font-medium">Group ID</th>
                  <th className="py-1 font-medium">Group Name</th>
                  <th className="py-1 font-medium">Scope</th>
                  <th className="py-1 font-medium">Role</th>
                  <th className="py-1 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((m) => (
                  <tr key={m.id} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-1 text-gray-700 dark:text-gray-300 font-mono text-xs">{m.idpGroupId}</td>
                    <td className="py-1 text-gray-600 dark:text-gray-400">{m.idpGroupName ?? "—"}</td>
                    <td className="py-1 text-gray-600 dark:text-gray-400">{m.targetScope}</td>
                    <td className="py-1 text-gray-600 dark:text-gray-400">{m.role}</td>
                    <td className="py-1">
                      <button
                        onClick={() => handleDeleteMapping(m.id)}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
