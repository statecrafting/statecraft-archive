/**
 * Connector framework barrel export (spec 087 Phase 4).
 */

export type {
  SourceConnector,
  SyncContext,
  SyncResult,
  SyncedObject,
  ValidationResult,
} from "./types";

export { getConnectorImpl, getRegisteredTypes } from "./registry";
