/**
 * Pure helpers to classify xray JSON for inspect UI states (T003).
 */

export type XrayClassify = 'ok' | 'empty_index';

/**
 * Treat an empty `files` list as degraded (scan succeeded but nothing indexed).
 */
export function classifyXrayIndexPayload(payload: unknown): XrayClassify {
  if (payload === null || typeof payload !== 'object') {
    return 'empty_index';
  }
  const files = (payload as { files?: unknown }).files;
  if (Array.isArray(files) && files.length === 0) {
    return 'empty_index';
  }
  return 'ok';
}
