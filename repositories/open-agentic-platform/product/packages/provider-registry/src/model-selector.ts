/** Provider ids that can be selected via `providerId:model` (spec 042 Phase 6). */
export const KNOWN_PROVIDER_IDS = [
  "anthropic",
  "openai",
  "gemini",
  "bedrock",
  "claude-code-sdk",
] as const;

export type KnownProviderId = (typeof KNOWN_PROVIDER_IDS)[number];

/**
 * Parses an optional `providerId:rest` prefix on the model string.
 * If the prefix is a known provider id, returns it and the remainder as the API model id.
 * Otherwise the legacy Claude Code path is used (no registry provider).
 */
export function parseProviderModel(model: string): {
  providerId: KnownProviderId | null;
  model: string;
} {
  const idx = model.indexOf(":");
  if (idx <= 0) {
    return { providerId: null, model };
  }
  const prefix = model.slice(0, idx);
  const rest = model.slice(idx + 1);
  if (
    (KNOWN_PROVIDER_IDS as readonly string[]).includes(prefix) &&
    rest.length > 0
  ) {
    return { providerId: prefix as KnownProviderId, model: rest };
  }
  return { providerId: null, model };
}
