// Spec 115 §5 / FR-011 row 3 — vision PDF extractor.
//
// Eligible only when the workspace policy allows vision AND the
// deterministic-text predecessor declined. Uses Anthropic's native
// document input — the SDK accepts `application/pdf` as a base64 block
// and the model OCR-extracts every page. Output is the concatenated
// per-page text returned by the model, with the per-call agentRun block
// populated for audit.

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

const KIND = "agent-pdf-vision";
const VERSION = "1";
const MAX_BYTES = 32 * 1024 * 1024; // 32MB Anthropic document limit

const PROMPT_KIND = "knowledge-extract.agent-pdf-vision";

async function loadBuffer(input: ExtractorInput): Promise<Buffer> {
  if (input.buffer) return input.buffer;
  return getObject(input.bucket, input.storageKey);
}

/**
 * Estimate input tokens for a PDF call. Anthropic charges roughly
 * 1500–2500 input tokens per page on a vision-extracted PDF; we use 2000
 * as a conservative midpoint plus the prompt body. Real numbers come back
 * via response.usage and are recorded on the run row.
 */
function estimatePdfInputTokens(sizeBytes: number, promptChars: number): number {
  // Approximation: PDF page ≈ 50KB; each page ≈ 2000 tokens. Plus the
  // prompt body at ~4 chars/token.
  const pages = Math.max(1, Math.ceil(sizeBytes / 50_000));
  return pages * 2000 + Math.ceil(promptChars / 4);
}

export const agentPdfVisionExtractor: Extractor = {
  kind: KIND,
  version: VERSION,
  maxBytes: MAX_BYTES,
  canHandle(input: ExtractorInput, policy): boolean {
    if (input.mimeType !== "application/pdf") return false;
    if (input.sizeBytes > MAX_BYTES) return false;
    if (!policy.visionAllowed) return false;
    return true;
  },
  async extract(
    input: ExtractorInput,
    ctx: ExtractorContext,
  ): Promise<ExtractionOutput> {
    const client = getAnthropicClient();
    const modelId = pickModelId(ctx.policy);
    const prompt = getExtractionPrompt(PROMPT_KIND);

    const startedAt = Date.now();
    const buf = await loadBuffer(input);

    const estimateTokens = estimatePdfInputTokens(
      input.sizeBytes,
      prompt.system.length,
    );
    const estimateOutput = Math.min(
      4000,
      Math.max(500, Math.round(estimateTokens * 0.3)),
    );

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
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: buf.toString("base64"),
          },
        },
        {
          type: "text",
          text: "Extract the textual content of this PDF page-by-page. Separate pages with the literal marker '<<<PAGE_BREAK>>>'.",
        },
      ],
      maxOutputTokens: estimateOutput,
    });

    const durationMs = Date.now() - startedAt;

    if (!result.text || result.text.length === 0) {
      // Empty model response is treated as extractor_failed (spec §4 edge
      // "Agent extractor returns empty text") — we do NOT silently store
      // an empty extraction.
      throw new ExtractorError({
        code: "extractor_failed",
        extractorKind: KIND,
        message: "agent returned empty text from PDF",
      });
    }

    const pages = result.text.split(/<<<PAGE_BREAK>>>/).map((t, i) => ({
      index: i,
      text: t.trim(),
    }));

    const metadata: Record<string, unknown> = {
      pageCount: pages.length,
      modelId,
      pdfBytes: input.sizeBytes,
      estimatedInputTokens: estimateTokens,
      estimatedCostUsd: estimateCallCostUsd({
        inputTokensEstimated: estimateTokens,
        outputTokensEstimated: estimateOutput,
      }),
    };

    return {
      text: pages.map((p) => p.text).join("\n\n").trim(),
      pages,
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
