import { createAnthropicProvider } from "./adapters/anthropic.js";
import { createBedrockProvider } from "./adapters/bedrock.js";
import {
  CLAUDE_CODE_SDK_PROVIDER_ID,
  createClaudeCodeSdkProvider,
} from "./adapters/claude-code-sdk.js";
import { createGeminiProvider } from "./adapters/gemini.js";
import { createOpenAIProvider } from "./adapters/openai.js";
import { getProviderRegistry } from "./registry.js";
import type { ProviderRegistry } from "./types.js";

const DEFAULT_CHAT_MODEL = "claude-sonnet-4-20250514";

/**
 * Registers built-in providers from environment (spec 042 Phase 6 — governed dispatch entry).
 * Idempotent: skips ids already present.
 */
export function registerBuiltInProvidersFromEnv(
  registry: ProviderRegistry = getProviderRegistry(),
): void {
  if (!registry.has(CLAUDE_CODE_SDK_PROVIDER_ID)) {
    registry.register(
      createClaudeCodeSdkProvider({
        id: CLAUDE_CODE_SDK_PROVIDER_ID,
        defaultModel: process.env.OPC_CLAUDE_CODE_MODEL?.trim() || DEFAULT_CHAT_MODEL,
      }),
    );
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (anthropicKey && !registry.has("anthropic")) {
    registry.register(
      createAnthropicProvider({
        id: "anthropic",
        apiKey: anthropicKey,
        defaultModel:
          process.env.ANTHROPIC_DEFAULT_MODEL?.trim() || DEFAULT_CHAT_MODEL,
      }),
    );
  }

  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiKey && !registry.has("openai")) {
    registry.register(
      createOpenAIProvider({
        id: "openai",
        apiKey: openaiKey,
        defaultModel:
          process.env.OPENAI_DEFAULT_MODEL?.trim() || "gpt-4o-mini",
      }),
    );
  }

  const geminiKey =
    process.env.GOOGLE_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
  if (geminiKey && !registry.has("gemini")) {
    registry.register(
      createGeminiProvider({
        id: "gemini",
        apiKey: geminiKey,
        defaultModel:
          process.env.GEMINI_DEFAULT_MODEL?.trim() || "gemini-1.5-flash",
      }),
    );
  }

  if (!registry.has("bedrock")) {
    const bedrockModel =
      process.env.BEDROCK_DEFAULT_MODEL?.trim() ||
      "us.anthropic.claude-3-5-sonnet-20241022-v2:0";
    registry.register(
      createBedrockProvider({
        id: "bedrock",
        defaultModel: bedrockModel,
        extra: {
          region: process.env.AWS_REGION?.trim() || "us-east-1",
        },
      }),
    );
  }
}
