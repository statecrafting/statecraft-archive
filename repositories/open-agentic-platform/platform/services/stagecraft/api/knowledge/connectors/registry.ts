/**
 * Connector registry (spec 087 Phase 4, NF-003).
 *
 * Maps connector type strings to their implementations.
 * Adding a new connector type requires only:
 *  1. Implementing the SourceConnector interface
 *  2. Registering it here
 * No changes to knowledge objects, factory integration, or API endpoints.
 */

import type { SourceConnector } from "./types";
import { UploadConnector } from "./upload";
import { SharePointConnector } from "./sharepoint";
import { S3Connector } from "./s3.js";
import { AzureBlobConnector } from "./azure-blob.js";
import { GcsConnector } from "./gcs.js";

const connectors = new Map<string, SourceConnector>();

function register(connector: SourceConnector) {
  connectors.set(connector.type, connector);
}

// Register all built-in connectors
register(new UploadConnector());
register(new SharePointConnector());
register(new S3Connector());
register(new AzureBlobConnector());
register(new GcsConnector());

/**
 * Get the connector implementation for a given type.
 * Returns undefined if the type is not registered.
 */
export function getConnectorImpl(type: string): SourceConnector | undefined {
  return connectors.get(type);
}

/**
 * Get all registered connector types.
 */
export function getRegisteredTypes(): string[] {
  return Array.from(connectors.keys());
}
