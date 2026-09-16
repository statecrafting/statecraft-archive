// Spec 112 §5.4 — opc:// deep link generation.
//
// Returned alongside `{ project_id, repo_url, clone_url }` on create and
// import. OPC registers the `opc://` scheme at install time and, on
// click, clones the repo locally and activates the Factory Cockpit
// (§4). The success page also renders the raw deep link so users on
// machines without OPC can copy-paste it later.

export interface DeepLinkInputs {
  projectId: string;
  cloneUrl: string;
  detectionLevel?: "scaffold_only" | "legacy_produced" | "acp_produced";
}

export function buildProjectOpenDeepLink(input: DeepLinkInputs): string {
  const params = new URLSearchParams();
  params.set("project_id", input.projectId);
  params.set("url", input.cloneUrl);
  if (input.detectionLevel) {
    params.set("level", input.detectionLevel);
  }
  return `opc://project/open?${params.toString()}`;
}
