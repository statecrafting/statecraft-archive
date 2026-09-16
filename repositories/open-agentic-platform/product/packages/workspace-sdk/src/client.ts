/**
 * Typed HTTP client for the Statecraft Platform API (spec 087).
 *
 * Provides workspace CRUD, knowledge intake, connector management,
 * and sync event posting. Consumed by OPC desktop and the web UI.
 */


import type {
  KnowledgeObject,
  SourceConnector,
  SyncRun,
  DocumentBinding,
  ConnectorType,
  ConnectorConfig,
  SyncSchedule,
} from "./knowledge";

import type { OpcEvent } from "./sync";

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

export interface StatecraftClientOptions {
  baseUrl: string;
  token: string;
}

export interface StatecraftClient {
  // -- Knowledge objects --
  listKnowledgeObjects(projectId: string): Promise<KnowledgeObject[]>;
  getKnowledgeObject(projectId: string, id: string): Promise<KnowledgeObject>;
  deleteKnowledgeObject(projectId: string, id: string): Promise<void>;
  requestUpload(projectId: string, filename: string, mimeType: string): Promise<{ uploadUrl: string; objectId: string }>;
  confirmUpload(projectId: string, objectId: string): Promise<KnowledgeObject>;

  // -- Connectors --
  listConnectors(projectId: string): Promise<SourceConnector[]>;
  getConnector(projectId: string, id: string): Promise<SourceConnector>;
  createConnector(projectId: string, req: CreateConnectorRequest): Promise<SourceConnector>;
  deleteConnector(projectId: string, id: string): Promise<void>;
  testConnection(projectId: string, id: string): Promise<{ ok: boolean; error?: string }>;
  triggerSync(projectId: string, connectorId: string): Promise<SyncRun>;
  listSyncRuns(projectId: string, connectorId: string): Promise<SyncRun[]>;

  // -- Bindings --
  listBindings(projectId: string): Promise<DocumentBinding[]>;
  bindToProject(projectId: string, knowledgeObjectId: string): Promise<DocumentBinding>;
  unbindFromProject(projectId: string, bindingId: string): Promise<void>;

  // -- Sync (OPC → Statecraft) --
  postOpcEvent(event: OpcEvent): Promise<void>;
}

export interface CreateConnectorRequest {
  type: ConnectorType;
  name: string;
  config: ConnectorConfig;
  syncSchedule?: SyncSchedule;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createStatecraftClient(opts: StatecraftClientOptions): StatecraftClient {
  const { baseUrl, token } = opts;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${baseUrl.replace(/\/$/, "")}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Statecraft API ${method} ${path} returned ${res.status}: ${text}`);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  return {
    // -- Knowledge objects --
    listKnowledgeObjects: (projectId) =>
      request<KnowledgeObject[]>("GET", `/api/projects/${projectId}/knowledge/objects`),
    getKnowledgeObject: (projectId, id) =>
      request<KnowledgeObject>("GET", `/api/projects/${projectId}/knowledge/objects/${id}`),
    deleteKnowledgeObject: (projectId, id) =>
      request<void>("DELETE", `/api/projects/${projectId}/knowledge/objects/${id}`),
    requestUpload: (projectId, filename, mimeType) =>
      request("POST", `/api/projects/${projectId}/knowledge/objects/upload`, { filename, mimeType }),
    confirmUpload: (projectId, objectId) =>
      request<KnowledgeObject>("POST", `/api/projects/${projectId}/knowledge/objects/${objectId}/confirm`),

    // -- Connectors --
    listConnectors: (projectId) =>
      request<SourceConnector[]>("GET", `/api/projects/${projectId}/knowledge/connectors`),
    getConnector: (projectId, id) =>
      request<SourceConnector>("GET", `/api/projects/${projectId}/knowledge/connectors/${id}`),
    createConnector: (projectId, req) =>
      request<SourceConnector>("POST", `/api/projects/${projectId}/knowledge/connectors`, req),
    deleteConnector: (projectId, id) =>
      request<void>("DELETE", `/api/projects/${projectId}/knowledge/connectors/${id}`),
    testConnection: (projectId, id) =>
      request("POST", `/api/projects/${projectId}/knowledge/connectors/${id}/test`),
    triggerSync: (projectId, connectorId) =>
      request<SyncRun>("POST", `/api/projects/${projectId}/knowledge/connectors/${connectorId}/sync`),
    listSyncRuns: (projectId, connectorId) =>
      request<SyncRun[]>("GET", `/api/projects/${projectId}/knowledge/connectors/${connectorId}/runs`),

    // -- Bindings --
    listBindings: (projectId) =>
      request<DocumentBinding[]>("GET", `/api/projects/${projectId}/bindings`),
    bindToProject: (projectId, knowledgeObjectId) =>
      request<DocumentBinding>("POST", `/api/projects/${projectId}/bindings`, { knowledgeObjectId }),
    unbindFromProject: (projectId, bindingId) =>
      request<void>("DELETE", `/api/projects/${projectId}/bindings/${bindingId}`),

    // -- Sync --
    postOpcEvent: (event) => request<void>("POST", "/api/sync/opc-events", event),
  };
}
