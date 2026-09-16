/**
 * Spec 123 — Org-scoped agent detail + editor.
 *
 * Drafts render an editable form for frontmatter and the markdown body.
 * Published/retired agents render read-only with a "Fork" CTA per spec 123
 * §6.1. Edit form uses optimistic locking via `expected_content_hash`.
 *
 * orgId is resolved from the authenticated user's JWT claims.
 */

import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  redirect,
} from "react-router";
import { useState } from "react";
import { requireUser } from "../lib/auth.server";
import {
  forkOrgAgent,
  getOrgAgent,
  patchOrgAgent,
  retireOrgAgent,
  type OrgCatalogAgent,
  type CatalogFrontmatter,
} from "../lib/agents-api.server";
import type { AgentType } from "../../../api/agents/frontmatter/AgentType";
import type { SafetyTier } from "../../../api/agents/frontmatter/SafetyTier";
import type { MutationCapability } from "../../../api/agents/frontmatter/MutationCapability";
import type { GovernanceRequirement } from "../../../api/agents/frontmatter/GovernanceRequirement";

const AGENT_TYPES: AgentType[] = [
  "prompt",
  "agent",
  "headless",
  "process",
  "scaffold",
];
const SAFETY_TIERS: SafetyTier[] = ["tier1", "tier2", "tier3"];
const MUTATIONS: MutationCapability[] = ["read-only", "read-write", "full"];
const GOVERNANCE: GovernanceRequirement[] = ["none", "advisory", "enforced"];

const STATUS_COLORS: Record<string, string> = {
  draft:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  published:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  retired:
    "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
};

export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { agentId: string };
}) {
  const user = await requireUser(request);
  const { agent } = await getOrgAgent(request, user.orgId, params.agentId);
  return { agent };
}

export async function action({
  request,
  params,
}: {
  request: Request;
  params: { agentId: string };
}) {
  const user = await requireUser(request);
  const form = await request.formData();
  const intent = form.get("intent");
  const base = "/app/agents";

  try {
    if (intent === "save") {
      const body_markdown = (form.get("body_markdown") as string | null) ?? "";
      const expected_content_hash =
        (form.get("expected_content_hash") as string | null) ?? undefined;
      const frontmatter = readFrontmatterFromForm(form);
      await patchOrgAgent(request, user.orgId, params.agentId, {
        frontmatter,
        body_markdown,
        expected_content_hash,
      });
      return { ok: true };
    }
    if (intent === "retire") {
      await retireOrgAgent(request, user.orgId, params.agentId);
      return redirect(`${base}/${params.agentId}`);
    }
    if (intent === "fork") {
      const newName = ((form.get("new_name") as string | null) ?? "").trim();
      if (!newName) return { error: "Fork requires a new name." };
      const { agent } = await forkOrgAgent(
        request,
        user.orgId,
        params.agentId,
        newName,
      );
      return redirect(`${base}/${agent.id}`);
    }
    return { error: `unknown intent: ${String(intent)}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      const parsed = JSON.parse(msg) as { message?: string };
      if (parsed.message) return { error: parsed.message };
    } catch {
      // fallthrough
    }
    return { error: msg || "Action failed." };
  }
}

function readFrontmatterFromForm(form: FormData): CatalogFrontmatter {
  const name = (form.get("name") as string | null)?.trim() ?? "";
  const type = (form.get("type") as AgentType) ?? "prompt";
  const description = (form.get("description") as string | null)?.trim() ?? "";
  const model = (form.get("model") as string | null)?.trim() ?? "";
  const safetyTier = form.get("safety_tier") as SafetyTier | "" | null;
  const mutation = form.get("mutation") as MutationCapability | "" | null;
  const governance =
    form.get("governance") as GovernanceRequirement | "" | null;
  const displayName =
    (form.get("display_name") as string | null)?.trim() ?? "";
  const trigger = (form.get("trigger") as string | null)?.trim() ?? "";
  const tagsRaw = (form.get("tags") as string | null) ?? "";
  const allowedToolsRaw = (form.get("allowed_tools") as string | null) ?? "*";
  const version = (form.get("version_label") as string | null)?.trim() ?? "";
  const author = (form.get("author") as string | null)?.trim() ?? "";
  const icon = (form.get("icon") as string | null)?.trim() ?? "";

  const tags = tagsRaw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const allowed_tools: CatalogFrontmatter["allowed_tools"] =
    allowedToolsRaw.trim() === "*" || allowedToolsRaw.trim() === ""
      ? "*"
      : allowedToolsRaw
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);

  return {
    name,
    type,
    allowed_tools,
    ...(description ? { description } : {}),
    ...(model ? { model } : {}),
    ...(safetyTier ? { safety_tier: safetyTier } : {}),
    ...(mutation ? { mutation } : {}),
    ...(governance ? { governance } : {}),
    ...(displayName ? { display_name: displayName } : {}),
    ...(trigger ? { trigger } : {}),
    ...(tags.length ? { tags } : {}),
    ...(version ? { version } : {}),
    ...(author ? { author } : {}),
    ...(icon ? { icon } : {}),
  };
}

export default function OrgAgentDetail() {
  const { agent } = useLoaderData() as { agent: OrgCatalogAgent };
  const actionData = useActionData() as
    | { error?: string; ok?: boolean }
    | undefined;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const editable = agent.status === "draft";
  const base = "/app/agents";

  return (
    <div className="space-y-6">
      <Header agent={agent} base={base} />

      {actionData?.error && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3">
          <p className="text-sm text-red-700 dark:text-red-400">
            {actionData.error}
          </p>
        </div>
      )}
      {actionData?.ok && (
        <div className="rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-4 py-3">
          <p className="text-sm text-green-700 dark:text-green-400">
            Saved. content_hash updated.
          </p>
        </div>
      )}

      {editable ? (
        <EditForm agent={agent} submitting={submitting} base={base} />
      ) : (
        <ReadOnlyView agent={agent} />
      )}

      <ForkSection agent={agent} />
    </div>
  );
}

function Header({ agent, base }: { agent: OrgCatalogAgent; base: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold font-mono text-gray-900 dark:text-gray-100">
            {agent.name}
          </h3>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            v{agent.version}
          </span>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[agent.status] ?? ""}`}
          >
            {agent.status}
          </span>
        </div>
        {agent.frontmatter.display_name && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {agent.frontmatter.display_name}
          </p>
        )}
        <p className="mt-1 text-xs font-mono text-gray-400 dark:text-gray-500 break-all">
          hash {agent.content_hash.slice(0, 16)}…
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Link
          to={`${base}/${agent.id}/history`}
          className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
        >
          History
        </Link>
        {agent.status === "draft" && (
          <Link
            to={`${base}/${agent.id}/publish`}
            className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Publish…
          </Link>
        )}
        {agent.status === "published" && (
          <Form method="post">
            <input type="hidden" name="intent" value="retire" />
            <button
              type="submit"
              className="inline-flex items-center rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              onClick={(e) => {
                if (!confirm(`Retire ${agent.name} v${agent.version}?`))
                  e.preventDefault();
              }}
            >
              Retire
            </button>
          </Form>
        )}
      </div>
    </div>
  );
}

function EditForm({
  agent,
  submitting,
  base,
}: {
  agent: OrgCatalogAgent;
  submitting: boolean;
  base: string;
}) {
  const fm = agent.frontmatter;
  const toolsValue = Array.isArray(fm.allowed_tools)
    ? fm.allowed_tools.join(", ")
    : "*";
  const tagsValue = (fm.tags ?? []).join(", ");

  return (
    <Form method="post" className="space-y-4">
      <input type="hidden" name="intent" value="save" />
      <input
        type="hidden"
        name="expected_content_hash"
        value={agent.content_hash}
      />

      <Field label="Name" id="name" defaultValue={fm.name} required mono />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SelectField
          label="Type"
          id="type"
          defaultValue={fm.type}
          options={AGENT_TYPES.map((t) => ({ value: t, label: t }))}
          required
        />
        <SelectField
          label="Safety tier"
          id="safety_tier"
          defaultValue={fm.safety_tier ?? ""}
          options={[
            { value: "", label: "(none)" },
            ...SAFETY_TIERS.map((t) => ({ value: t, label: t })),
          ]}
        />
        <SelectField
          label="Mutation"
          id="mutation"
          defaultValue={fm.mutation ?? ""}
          options={[
            { value: "", label: "(derive from tier)" },
            ...MUTATIONS.map((m) => ({ value: m, label: m })),
          ]}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field
          label="Model"
          id="model"
          defaultValue={fm.model ?? ""}
          placeholder="opus"
        />
        <Field
          label="Display name"
          id="display_name"
          defaultValue={fm.display_name ?? ""}
        />
      </div>

      <TextareaField
        label="Description"
        id="description"
        rows={2}
        defaultValue={fm.description ?? ""}
        help="Min 50 chars recommended."
      />

      <Field
        label="Trigger"
        id="trigger"
        defaultValue={fm.trigger ?? ""}
        help="Optional auto-routing condition."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SelectField
          label="Governance"
          id="governance"
          defaultValue={fm.governance ?? ""}
          options={[
            { value: "", label: "(unset)" },
            ...GOVERNANCE.map((g) => ({ value: g, label: g })),
          ]}
        />
        <Field
          label="Version label"
          id="version_label"
          defaultValue={fm.version ?? ""}
          help="semantic version string"
        />
      </div>

      <Field
        label="Tags"
        id="tags"
        defaultValue={tagsValue}
        help="comma-separated"
      />

      <Field
        label="Allowed tools"
        id="allowed_tools"
        defaultValue={toolsValue}
        help="comma-separated or *"
        mono
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Author" id="author" defaultValue={fm.author ?? ""} />
        <Field label="Icon" id="icon" defaultValue={fm.icon ?? ""} />
      </div>

      <TextareaField
        label="System prompt (markdown)"
        id="body_markdown"
        rows={18}
        defaultValue={agent.body_markdown}
        required
        mono
      />

      <div className="flex items-center gap-4 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Save draft"}
        </button>
        <Link
          to={base}
          className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
        >
          Back to list
        </Link>
      </div>
    </Form>
  );
}

function ReadOnlyView({ agent }: { agent: OrgCatalogAgent }) {
  const fm = agent.frontmatter;
  const tools = Array.isArray(fm.allowed_tools)
    ? fm.allowed_tools.join(", ")
    : fm.allowed_tools;

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 px-4 py-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {agent.status === "retired"
            ? "This version is retired. Fork it to start a new draft."
            : "Published versions are immutable. Fork to create a new draft, then publish to replace this version."}
        </p>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <Field2 label="type" value={fm.type} />
        <Field2 label="safety_tier" value={fm.safety_tier ?? "—"} />
        <Field2 label="mutation" value={fm.mutation ?? "—"} />
        <Field2 label="governance" value={fm.governance ?? "—"} />
        <Field2 label="model" value={fm.model ?? "—"} />
        <Field2 label="display_name" value={fm.display_name ?? "—"} />
        <Field2 label="tags" value={(fm.tags ?? []).join(", ") || "—"} />
        <Field2 label="allowed_tools" value={tools || "*"} mono />
      </dl>

      {fm.description && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">
            Description
          </h4>
          <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
            {fm.description}
          </p>
        </div>
      )}

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">
          System prompt
        </h4>
        <pre className="text-xs font-mono text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md p-3 whitespace-pre-wrap overflow-x-auto">
          {agent.body_markdown}
        </pre>
      </div>
    </div>
  );
}

function ForkSection({ agent }: { agent: OrgCatalogAgent }) {
  const [newName, setNewName] = useState("");
  return (
    <details className="border-t border-gray-200 dark:border-gray-700 pt-4">
      <summary className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer select-none">
        Fork into a new draft
      </summary>
      <Form method="post" className="mt-3 flex items-end gap-3">
        <input type="hidden" name="intent" value="fork" />
        <div className="flex-1 max-w-xs">
          <label
            htmlFor="new_name"
            className="block text-xs text-gray-500 dark:text-gray-400"
          >
            New name (kebab-case)
          </label>
          <input
            type="text"
            id="new_name"
            name="new_name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            pattern="[a-z][a-z0-9]*(-[a-z0-9]+)*"
            className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 font-mono focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            placeholder={`${agent.name}-v2`}
          />
        </div>
        <button
          type="submit"
          disabled={!newName}
          className="inline-flex items-center rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
        >
          Fork
        </button>
      </Form>
    </details>
  );
}

function Field({
  label,
  id,
  defaultValue,
  required,
  placeholder,
  help,
  mono,
}: {
  label: string;
  id: string;
  defaultValue?: string;
  required?: boolean;
  placeholder?: string;
  help?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-sm font-medium text-gray-700 dark:text-gray-300"
      >
        {label}
      </label>
      <input
        type="text"
        id={id}
        name={id}
        defaultValue={defaultValue}
        required={required}
        placeholder={placeholder}
        className={`mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 ${mono ? "font-mono" : ""}`}
      />
      {help && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{help}</p>
      )}
    </div>
  );
}

function SelectField({
  label,
  id,
  defaultValue,
  options,
  required,
}: {
  label: string;
  id: string;
  defaultValue: string;
  options: { value: string; label: string }[];
  required?: boolean;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-sm font-medium text-gray-700 dark:text-gray-300"
      >
        {label}
      </label>
      <select
        id={id}
        name={id}
        defaultValue={defaultValue}
        required={required}
        className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function TextareaField({
  label,
  id,
  rows,
  defaultValue,
  help,
  required,
  mono,
}: {
  label: string;
  id: string;
  rows: number;
  defaultValue?: string;
  help?: string;
  required?: boolean;
  mono?: boolean;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-sm font-medium text-gray-700 dark:text-gray-300"
      >
        {label}
      </label>
      <textarea
        id={id}
        name={id}
        rows={rows}
        defaultValue={defaultValue}
        required={required}
        className={`mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 ${mono ? "font-mono" : ""}`}
      />
      {help && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{help}</p>
      )}
    </div>
  );
}

function Field2({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {label}
      </dt>
      <dd
        className={`text-sm text-gray-900 dark:text-gray-100 ${mono ? "font-mono" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
