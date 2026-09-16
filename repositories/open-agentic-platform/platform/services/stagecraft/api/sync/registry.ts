/**
 * Sync connection registry — org + client scoped, in-memory, process-local.
 *
 * Structure: orgId -> clientId -> Session
 *
 * This is runtime state only. It is NOT a source of truth. Membership,
 * authority, and audit all live in the Postgres control plane.
 *
 * Horizontal scale-out: when statecraft runs >1 replica, server-originated
 * events must fan out via PubSub/Redis to all replicas; each replica then
 * consults its own local registry. The service layer is structured so the
 * registry boundary is the only place that needs to learn about that.
 *
 * Spec 119: scope key is `orgId`.
 */
import log from "encore.dev/log";
import type { ServerEnvelope, SyncStream } from "./types";

export interface SessionMeta {
  orgId: string;
  clientId: string;
  clientKind: string;
  userId: string;
  connectedAt: Date;
  lastHeartbeatAt: Date;
  /** Monotonic cursor of the last outbound event sent to this client. */
  lastSentCursor?: string;
}

export interface Session {
  meta: SessionMeta;
  stream: SyncStream;
}

// orgId -> clientId -> Session
const orgs: Map<string, Map<string, Session>> = new Map();

export function register(session: Session): void {
  const { orgId, clientId } = session.meta;
  let clients = orgs.get(orgId);
  if (!clients) {
    clients = new Map();
    orgs.set(orgId, clients);
  }

  const existing = clients.get(clientId);
  if (existing) {
    // Replace any stale session for the same clientId. Close the old stream
    // best-effort so the old transport tears down cleanly.
    existing.stream.close().catch(() => undefined);
    log.info("sync: replacing stale session", { orgId, clientId });
  }

  clients.set(clientId, session);
  log.info("sync: session registered", {
    orgId,
    clientId,
    clientKind: session.meta.clientKind,
    userId: session.meta.userId,
    orgSessions: clients.size,
  });
}

export function unregister(
  orgId: string,
  clientId: string,
  stream?: SyncStream,
): void {
  const clients = orgs.get(orgId);
  if (!clients) return;
  const existing = clients.get(clientId);
  if (!existing) return;
  // Stream-identity guard (spec 183 — duplex reconnect race). A reconnecting
  // client reuses its `clientId`, so a newer session can already occupy this
  // (orgId, clientId) slot by the time the OLD connection tears down. The old
  // connection's `finally` MUST NOT evict the live replacement. Only delete
  // when the registered session is the caller's own (or when no stream is
  // supplied — server-originated prunes in sendTo/broadcastOrg act on the
  // session they just fetched, which is by definition the current one).
  if (stream && existing.stream !== stream) {
    log.info("sync: unregister skipped — newer session holds the slot", {
      orgId,
      clientId,
    });
    return;
  }
  clients.delete(clientId);
  log.info("sync: session unregistered", {
    orgId,
    clientId,
    remaining: clients.size,
  });
  if (clients.size === 0) orgs.delete(orgId);
}

export function get(orgId: string, clientId: string): Session | undefined {
  return orgs.get(orgId)?.get(clientId);
}

export function listOrg(orgId: string): Session[] {
  const clients = orgs.get(orgId);
  return clients ? Array.from(clients.values()) : [];
}

export function orgCount(): number {
  return orgs.size;
}

export function sessionCount(orgId?: string): number {
  if (orgId) return orgs.get(orgId)?.size ?? 0;
  let total = 0;
  for (const clients of orgs.values()) total += clients.size;
  return total;
}

/**
 * Send to a single client in an org. Returns true if sent, false if the
 * client is not connected or the send failed (in which case the session is
 * pruned).
 */
export async function sendTo(
  orgId: string,
  clientId: string,
  event: ServerEnvelope,
): Promise<boolean> {
  const session = get(orgId, clientId);
  if (!session) return false;
  try {
    await session.stream.send(event);
    session.meta.lastSentCursor = event.meta.orgCursor;
    return true;
  } catch (err) {
    log.warn("sync: send failed, pruning session", {
      orgId,
      clientId,
      err: err instanceof Error ? err.message : String(err),
    });
    unregister(orgId, clientId);
    return false;
  }
}

/**
 * Broadcast to every client in an org. Optionally exclude one clientId
 * (useful to avoid echoing a client's own event back to it).
 */
export async function broadcastOrg(
  orgId: string,
  event: ServerEnvelope,
  opts: { excludeClientId?: string } = {},
): Promise<{ sent: number; pruned: number }> {
  const clients = orgs.get(orgId);
  if (!clients || clients.size === 0) return { sent: 0, pruned: 0 };

  let sent = 0;
  let pruned = 0;
  const dead: string[] = [];

  for (const [clientId, session] of clients) {
    if (opts.excludeClientId && clientId === opts.excludeClientId) continue;
    try {
      await session.stream.send(event);
      session.meta.lastSentCursor = event.meta.orgCursor;
      sent++;
    } catch (err) {
      dead.push(clientId);
      log.warn("sync: broadcast send failed", {
        orgId,
        clientId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  for (const clientId of dead) {
    unregister(orgId, clientId);
    pruned++;
  }

  return { sent, pruned };
}

/** Test-only helper — wipes the registry between tests. */
export function __resetForTests(): void {
  orgs.clear();
}
