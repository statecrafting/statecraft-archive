// Spec 115 §5 / FR-011 row 4 — vision image extractor.
//
// Single-shot vision call. Eligible when the policy allows vision and the
// mime type is one of the supported image families.

import type { Extractor, ExtractorContext, ExtractorInput } from "./types";
import type { ExtractionOutput } from "../extractionOutput";
import { ExtractorError } from "./types";
import { getObject } from "../storage";
import { getExtractionPrompt } from "../prompts";
import {
  buildAgentRun,
  estimateCallCostUsd,
  getAnthropicClient,
  pickModelId,
  runAgentMessage,
} from "./agent-base";

const KIND = "agent-image-vision";
const VERSION = "1";
const MAX_BYTES = 20 * 1024 * 1024; // Anthropic image cap

const PROMPT_KIND = "knowledge-extract.agent-image-vision";

const HANDLED_MIMES: Record<string, "image/png" | "image/jpeg" | "image/webp" | "image/gif"> = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/webp": "image/webp",
  "image/gif": "image/gif",
};

async function loadBuffer(input: ExtractorInput): Promise<Buffer> {
  if (input.buffer) return input.buffer;
  return getObject(input.bucket, input.storageKey);
}

function estimateImageInputTokens(
  sizeBytes: number,
  promptChars: number,
): number {
  // Anthropic vision images are roughly 1100–1600 tokens regardless of
  // file size (the model resamples at the API gateway). Use 1500 as a
  // conservative point estimate plus the prompt body at 4 chars/token.
  return 1500 + Math.ceil(promptChars / 4);
}

export const agentImageVisionExtractor: Extractor = {
  kind: KIND,
  version: VERSION,
  maxBytes: MAX_BYTES,
  canHandle(input: ExtractorInput, policy): boolean {
    if (!policy.visionAllowed) return false;
    if (input.sizeBytes > MAX_BYTES) return false;
    return input.mimeType in HANDLED_MIMES;
  },
  async extract(
    input: ExtractorInput,
    ctx: ExtractorContext,
  ): Promise<ExtractionOutput> {
    const client = getAnthropicClient();
    const modelId = pickModelId(ctx.policy);
    const prompt = getExtractionPrompt(PROMPT_KIND);

    const mediaType = HANDLED_MIMES[input.mimeType];
    if (!mediaType) {
      throw new ExtractorError({
        code: "extractor_failed",
        extractorKind: KIND,
        message: `image extractor reached extract() with unsupported mime ${input.mimeType}`,
      });
    }

    const startedAt = Date.now();
    const buf = await loadBuffer(input);

    const estimateTokens = estimateImageInputTokens(
      input.sizeBytes,
      prompt.system.length,
    );
    const estimateOutput = 1500;

    const result = await runAgentMessage({
      client,
      modelId,
      prompt,
      policy: ctx.policy,
      projectId: input.projectId,
      extractorKind: KIND,
      reportTokenSpend: ctx.reportTokenSpend,
      estimate: {
        inputTokensEstimated: estimateTokens,
        outputTokensEstimated: estimateOutput,
      },
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: mediaType,
            data: buf.toString("base64"),
          },
        },
        {
          type: "text",
          text: "Extract the visible text from this image.",
        },
      ],
      maxOutputTokens: estimateOutput,
    });

    const durationMs = Date.now() - startedAt;

    if (!result.text || result.text.length === 0) {
      throw new ExtractorError({
        code: "extractor_failed",
        extractorKind: KIND,
        message: "agent returned empty text from image",
      });
    }

    const metadata: Record<string, unknown> = {
      modelId,
      imageBytes: input.sizeBytes,
      mimeType: input.mimeType,
      estimatedInputTokens: estimateTokens,
      estimatedCostUsd: estimateCallCostUsd({
        inputTokensEstimated: estimateTokens,
        outputTokensEstimated: estimateOutput,
      }),
    };

    return {
      text: result.text,
      metadata,
      extractor: {
        kind: KIND,
        version: VERSION,
        agentRun: buildAgentRun({
          modelId,
          prompt,
          durationMs,
          spend: result.spend,
          costUsd: result.costUsd,
          attempts: 1,
        }),
      },
    };
  },
};
