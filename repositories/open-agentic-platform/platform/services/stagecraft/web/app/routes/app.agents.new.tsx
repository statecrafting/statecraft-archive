/**
 * Spec 123 — Create a draft agent in the org catalog.
 *
 * Captures the minimum viable draft: name (kebab-case, org-unique),
 * Tier-1 frontmatter (type, description, safety_tier, model, tags, display
 * name, allowed_tools), and the system prompt body. Full frontmatter fields
 * are editable from the detail view after creation.
 *
 * orgId is resolved from the authenticated user's JWT claims.
 */

import { Form, redirect, useActionData, useNavigation } from "react-router";
import { useState } from "react";
import { requireUser } from "../lib/auth.server";
import {
  createOrgAgent,
  type CatalogFrontmatter,
} from "../lib/agents-api.server";
import type { AgentType } from "../../../api/agents/frontmatter/AgentType";
import type { SafetyTier } from "../../../api/agents/frontmatter/SafetyTier";

const AGENT_TYPES: AgentType[] = [
  "prompt",
  "agent",
  "headless",
  "process",
  "scaffold",
];
const SAFETY_TIERS: SafetyTier[] = ["tier1", "tier2", "tier3"];

export async function loader({ request }: { request: Request }) {
  await requireUser(request);
  return null;
}

export async function action({ request }: { request: Request }) {
  const user = await requireUser(request);
  const form = await request.formData();

  const name = (form.get("name") as string | null)?.trim() ?? "";
  const type = (form.get("type") as AgentType) ?? "prompt";
  const description = (form.get("description") as string | null)?.trim() ?? "";
  const model = (form.get("model") as string | null)?.trim() ?? "";
  const safetyTier = form.get("safety_tier") as SafetyTier | "" | null;
  const displayName =
    (form.get("display_name") as string | null)?.trim() ?? "";
  const tagsRaw = (form.get("tags") as string | null) ?? "";
  const allowedToolsRaw = (form.get("allowed_tools") as string | null) ?? "*";
  const bodyMarkdown = (form.get("body_markdown") as string | null) ?? "";

  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
    return {
      error:
        "Name must be kebab-case: start with a letter, lowercase alphanumeric and hyphens only.",
    };
  }
  if (bodyMarkdown.length === 0) {
    return { error: "System prompt body is required." };
  }

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

  const frontmatter: CatalogFrontmatter = {
    name,
    type,
    allowed_tools,
    ...(description ? { description } : {}),
    ...(model ? { model } : {}),
    ...(safetyTier ? { safety_tier: safetyTier } : {}),
    ...(displayName ? { display_name: displayName } : {}),
    ...(tags.length ? { tags } : {}),
  };

  try {
    const { agent } = await createOrgAgent(request, user.orgId, {
      name,
      frontmatter,
      body_markdown: bodyMarkdown,
    });
    return redirect(`/app/agents/${agent.id}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      const parsed = JSON.parse(msg) as { message?: string };
      if (parsed.message) return { error: parsed.message };
    } catch {
      // fallthrough
    }
    return { error: msg || "Failed to create agent draft." };
  }
}

export default function NewOrgAgentDraft() {
  const actionData = useActionData() as { error?: string } | undefined;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [name, setName] = useState("");

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          New agent draft
        </h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Drafts are private to the org catalog until publication. Publishing
          bumps the version and fans the agent out to every connected OPC.
        </p>
      </div>

      {actionData?.error && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3">
          <p className="text-sm text-red-700 dark:text-red-400">
            {actionData.error}
          </p>
        </div>
      )}

      <Form method="post" className="space-y-4">
        <Field
          label="Name"
          help="kebab-case; unique per org"
          id="name"
          required
          value={name}
          onChange={setName}
          mono
          placeholder="triage-bot"
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SelectField
            label="Type"
            name="type"
            id="type"
            defaultValue="prompt"
            options={AGENT_TYPES.map((t) => ({ value: t, label: t }))}
            required
          />
          <SelectField
            label="Safety tier"
            name="safety_tier"
            id="safety_tier"
            defaultValue=""
            options={[
              { value: "", label: "(derive from mutation)" },
              ...SAFETY_TIERS.map((t) => ({ value: t, label: t })),
            ]}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field
            label="Model"
            id="model"
            help="e.g. opus, sonnet, haiku"
            placeholder="opus"
          />
          <Field
            label="Display name"
            id="display_name"
            help="human-friendly label"
            placeholder="Triage Bot"
          />
        </div>

        <TextareaField
          label="Description"
          id="description"
          rows={2}
          help="What this agent does. Min 50 chars recommended for the lint rule."
        />

        <Field
          label="Tags"
          id="tags"
          help="comma-separated catalog tags"
          placeholder="ops, triage"
        />

        <Field
          label="Allowed tools"
          id="allowed_tools"
          help="comma-separated list, or * for all"
          defaultValue="*"
          mono
        />

        <TextareaField
          label="System prompt (markdown)"
          id="body_markdown"
          rows={14}
          required
          mono
        />

        <div className="flex items-center gap-4 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create draft"}
          </button>
          <a
            href="/app/agents"
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
          >
            Cancel
          </a>
        </div>
      </Form>
    </div>
  );
}

type FieldProps = {
  label: string;
  id: string;
  help?: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  value?: string;
  onChange?: (v: string) => void;
  mono?: boolean;
};

function Field({
  label,
  id,
  help,
  required,
  placeholder,
  defaultValue,
  value,
  onChange,
  mono,
}: FieldProps) {
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
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue}
        {...(value !== undefined
          ? { value, onChange: (e) => onChange?.(e.target.value) }
          : {})}
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
  name,
  defaultValue,
  options,
  required,
}: {
  label: string;
  id: string;
  name: string;
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
        name={name}
        required={required}
        defaultValue={defaultValue}
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
  help,
  required,
  mono,
}: {
  label: string;
  id: string;
  rows: number;
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
        required={required}
        className={`mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 ${mono ? "font-mono" : ""}`}
      />
      {help && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{help}</p>
      )}
    </div>
  );
}
