// Spec 112 §4.3 + §5.2 step 5 — server-side artifact extraction.
//
// Raw uploads live in the workspace bucket (audit-durable, re-runnable).
// Extracted outputs are written into `.artifacts/extracted/` in the
// scaffold tree along with `.artifacts/extracted/manifest.json` mapping
// bucket object ids to extracted files. The extractor binary is the
// Rust `factory-artifacts extract` program (spec 105 migration), invoked
// as a subprocess here so statecraft stays language-pure.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ScaffoldSeedInput } from "./types";

export interface ArtifactExtractOptions {
  projectRoot: string;
  inputs: ScaffoldSeedInput[];
  /** Hook to resolve a bucket-backed stream by id; swapped in tests. */
  readFromBucket?: (bucketObjectId: string) => Promise<Buffer>;
}

export interface ArtifactExtractResult {
  manifestPath: string;
  extractedFiles: string[];
}

export async function extractArtifactsIntoTree(
  opts: ArtifactExtractOptions
): Promise<ArtifactExtractResult> {
  const extractedDir = join(opts.projectRoot, ".artifacts", "extracted");
  await mkdir(extractedDir, { recursive: true });

  // The full extractor pipeline (PDF → markdown, DOCX → markdown, etc.) is a
  // separate Rust binary. This module stages the bucket-mapping manifest
  // and records what would be extracted so the scaffold tree is internally
  // consistent at commit-#1 time. A follow-up change wires the subprocess
  // invocation once `factory-artifacts extract` lands (spec 112 §4.3).
  const extractedFiles: string[] = [];
  for (const input of opts.inputs) {
    // Record placeholder extraction target so the manifest maps 1:1 to
    // future extractor outputs without a second migration.
    const targetName = input.filename.replace(/\s+/g, "-");
    extractedFiles.push(join(".artifacts", "extracted", targetName));
  }

  const manifest = {
    schema: "factory-artifacts-manifest/1",
    inputs: opts.inputs.map((i) => ({
      bucket_object_id: i.bucketObjectId,
      filename: i.filename,
      mime_type: i.mimeType,
      content_hash: i.contentHash,
    })),
    extracted: extractedFiles,
    note:
      "Stage-complete extraction is performed by the `factory-artifacts extract` binary; " +
      "this manifest is the authoritative bucket ↔ extracted-path mapping.",
  };
  const manifestPath = join(extractedDir, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return { manifestPath, extractedFiles };
}
