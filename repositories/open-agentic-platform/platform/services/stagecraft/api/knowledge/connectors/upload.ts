/**
 * Upload connector — reference implementation (spec 087 Phase 4).
 *
 * The upload connector represents direct browser/API uploads. It does not
 * perform scheduled sync — uploads are one-shot, initiated by the user.
 * The sync() method is a no-op because the actual upload flow is handled
 * by the requestUpload/confirmUpload endpoints.
 */

import type {
  SourceConnector,
  SyncContext,
  SyncResult,
  ValidationResult,
} from "./types";

export class UploadConnector implements SourceConnector {
  readonly type = "upload";

  validateConfig(_config: Record<string, unknown>): ValidationResult {
    // Upload connector has no configuration
    return { valid: true, errors: [] };
  }

  async testConnection(_config: Record<string, unknown>): Promise<void> {
    // Upload connector is always "connected" — it's user-initiated
  }

  async sync(_ctx: SyncContext): Promise<SyncResult> {
    // Upload connector does not sync — uploads are one-shot via presigned URLs.
    // This method exists to satisfy the interface but will never be called
    // by the scheduler (upload connectors have no sync_schedule).
    return { objects: [], deltaToken: null };
  }
}
