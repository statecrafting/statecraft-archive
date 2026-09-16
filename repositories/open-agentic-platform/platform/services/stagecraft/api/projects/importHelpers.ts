// Spec 112 Phase 6 — pure helpers extracted from `import.ts` so they
// can be unit-tested without loading the Encore native runtime.

export const TRANSLATOR_VERSION = "spec-112-v1";

/**
 * Extension → MIME lookup used when uploading raw artifacts through the
 * Import flow. Narrow on purpose — anything unrecognised falls back to
 * octet-stream (fine for audit-durable storage; the extract CLI does its
 * own header sniffing on the way in).
 */
export function guessMimeType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".xlsx"))
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".pptx"))
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (lower.endsWith(".pbix")) return "application/octet-stream";
  if (lower.endsWith(".zip")) return "application/zip";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

export function parseRepoUrlImpl(input: string): { owner: string; repo: string } {
  const trimmed = input.trim();
  const shortForm = /^([^\s/]+)\/([^\s/]+?)(?:\.git)?$/.exec(trimmed);
  if (shortForm) {
    return { owner: shortForm[1], repo: shortForm[2] };
  }
  const url = new URL(trimmed); // throws on invalid URL
  if (!/^(www\.)?github\.com$/i.test(url.host)) {
    throw new Error(
      `Expected github.com host, got "${url.host}". Only GitHub repos are importable.`
    );
  }
  const parts = url.pathname.replace(/^\//, "").replace(/\.git$/i, "").split("/");
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error(`Could not parse owner/repo from URL: ${trimmed}`);
  }
  return { owner: parts[0], repo: parts[1] };
}
