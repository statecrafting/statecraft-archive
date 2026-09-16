/**
 * Authenticated duplex sync endpoint.
 *
 *   WebSocket /api/sync/duplex?clientId=…&clientKind=…&lastServerCursor=…
 *
 * The handshake carries the caller-chosen clientId and clientKind. The
 * authenticated orgId is taken from the Rauthy JWT — NOT from the
 * handshake — so a client cannot subscribe to an org it does not own.
 *
 * Spec 119: scope key is `orgId`.
 */
import { api } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import log from "encore.dev/log";
import { randomUUID } from "node:crypto";
import type {
  SyncHandshake,
  ServerHello,
  ClientEnvelopeWire,
  ServerEnvelopeWire,
} from "./types";
import { ENVELOPE_SCHEMA_VERSION } from "./types";
import type { SessionMeta } from "./registry";
import * as registry from "./registry";
import {
  handleInbound,
  publishAck,
  publishNack,
  type InboundContext,
} from "./service";
import { cursors } from "./store";
import {
  sendAgentCatalogSnapshot,
  sendProjectAgentBindingSnapshot,
  listProjectIdsForOrg,
} from "../agents/relay";
import { sendProjectCatalogSnapshot } from "./projectCatalogRelay";
import { isHaltedInScope } from "../factory/orgHalt";

const HEARTBEAT_INTERVAL_MS = 30_000;
const SERVER_STARTED_AT = new Date().toISOString();

export const duplex = api.streamInOut<
  SyncHandshake,
  ClientEnvelopeWire,
  ServerEnvelopeWire
>(
  { expose: true, auth: true, path: "/api/sync/duplex" },
  async (handshake, stream) => {
    // Diagnostic (spec 183): log handler entry + resolved auth so a post-sign-in
    // reconnect that reaches the endpoint but never registers is not invisible;
    // read auth null-safely so a null context nacks+closes (like the guards
    // below) instead of throwing past the logs.
    const auth = getAuthData();
    log.info("sync: duplex handler entered", {
      clientId: handshake.clientId,
      clientKind: handshake.clientKind,
      lastServerCursor: handshake.lastServerCursor ?? null,
      hasAuth: auth != null,
      orgId: auth?.orgId ?? null,
    });
    if (!auth) {
      log.warn(
        "sync: duplex aborted — getAuthData() returned null in the stream handler despite the auth handler completing",
        { clientId: handshake.clientId },
      );
      await stream
        .send({
          kind: "sync.nack",
          meta: {
            v: ENVELOPE_SCHEMA_VERSION,
            eventId: randomUUID(),
            sentAt: new Date().toISOString(),
            orgId: "",
            orgCursor: "",
          },
          clientEventId: "",
          reason: "unauthorized",
          // Client-facing detail stays generic; the precise cause (null auth
          // context in the stream handler) is in the server log.warn above.
          detail: "authentication unavailable",
        })
        .catch(() => undefined);
      await stream.close();
      return;
    }
    const orgId = auth.orgId;

    if (!orgId) {
      log.warn("sync: handshake rejected — no org in auth context", {
        userId: auth.userID,
        clientId: handshake.clientId,
      });
      await stream
        .send({
          kind: "sync.nack",
          meta: {
            v: ENVELOPE_SCHEMA_VERSION,
            eventId: randomUUID(),
            sentAt: new Date().toISOString(),
            orgId: "",
            orgCursor: "",
          },
          clientEventId: "",
          reason: "unauthorized",
          detail: "no org context in auth token",
        })
        .catch(() => undefined);
      await stream.close();
      return;
    }

    if (!handshake.clientId || typeof handshake.clientId !== "string") {
      await stream
        .send({
          kind: "sync.nack",
          meta: {
            v: ENVELOPE_SCHEMA_VERSION,
            eventId: randomUUID(),
            sentAt: new Date().toISOString(),
            orgId,
            orgCursor: "",
          },
          clientEventId: "",
          reason: "invalid",
          detail: "handshake.clientId required",
        })
        .catch(() => undefined);
      await stream.close();
      return;
    }

    // Spec 208 FR-001: an active org-scoped halt refuses a new agent session
    // at duplex registration, fail-closed before any traffic is served. The
    // duplex connection is org-scoped (one per org) and the handshake carries
    // no projectId, so only org-scoped halts gate here; project-scoped session
    // refusal is exact at the grant seam (which carries projectId). The nack
    // reuses "unauthorized" with a detail that names the quarantine record
    // (AC-2). A disconnected engine hits this same check at the reconnect
    // handshake (FR-003 "refused at the reconnect handshake").
    const haltId = await isHaltedInScope(orgId);
    if (haltId) {
      log.info("sync: duplex registration refused, org halted", {
        orgId,
        clientId: handshake.clientId,
        haltId,
      });
      await stream
        .send({
          kind: "sync.nack",
          meta: {
            v: ENVELOPE_SCHEMA_VERSION,
            eventId: randomUUID(),
            sentAt: new Date().toISOString(),
            orgId,
            orgCursor: "",
          },
          clientEventId: "",
          reason: "unauthorized",
          detail: `org halt ${haltId} is active: new agent sessions are refused`,
        })
        .catch(() => undefined);
      await stream.close();
      return;
    }

    const sessionMeta: SessionMeta = {
      orgId,
      clientId: handshake.clientId,
      clientKind: handshake.clientKind ?? "unknown",
      userId: auth.userID,
      connectedAt: new Date(),
      lastHeartbeatAt: new Date(),
    };
    registry.register({ meta: sessionMeta, stream });

    const ctx: InboundContext = {
      orgId,
      clientId: handshake.clientId,
      userId: auth.userID,
    };

    // Greet the client with a ServerHello so it sees the current cursor and
    // session ID before any other traffic.
    const lastCursor = cursors.peek(orgId);
    const cursorGap =
      handshake.lastServerCursor !== undefined &&
      lastCursor !== undefined &&
      handshake.lastServerCursor !== lastCursor;

    const hello: ServerHello = {
      kind: "sync.hello",
      meta: {
        v: ENVELOPE_SCHEMA_VERSION,
        eventId: randomUUID(),
        sentAt: new Date().toISOString(),
        orgId,
        orgCursor: lastCursor ?? cursors.next(orgId),
      },
      sessionId: `${orgId}:${handshake.clientId}`,
      serverStartedAt: SERVER_STARTED_AT,
      cursorGap,
    };
    // Diagnostic (spec 183): the hello send was `.catch(() => undefined)` —
    // silent on success AND failure. Log both, with the success log OUTSIDE the
    // try so a throw from it is NOT caught and misattributed as a send failure.
    // Fail-soft: a failed send is logged and the handler continues (the dead
    // socket self-cleans via the heartbeat path) — it must not throw out.
    let helloSent = false;
    try {
      await stream.send(hello);
      helloSent = true;
    } catch (err) {
      log.warn("sync: hello send failed", {
        orgId,
        clientId: handshake.clientId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    if (helloSent) {
      log.info("sync: hello sent", {
        orgId,
        clientId: handshake.clientId,
        sessionId: hello.sessionId,
        orgCursor: hello.meta.orgCursor,
        cursorGap,
        lastServerCursor: handshake.lastServerCursor ?? null,
      });
    }

    if (cursorGap) {
      log.info("sync: cursor gap — sending resync_required", {
        orgId,
        clientId: handshake.clientId,
        clientCursor: handshake.lastServerCursor ?? null,
        serverCursor: lastCursor ?? null,
      });
      await stream
        .send({
          kind: "sync.resync_required",
          meta: {
            v: ENVELOPE_SCHEMA_VERSION,
            eventId: randomUUID(),
            sentAt: new Date().toISOString(),
            orgId,
            orgCursor: cursors.next(orgId),
          },
          reason: "cursor_gap",
        })
        .catch((err) =>
          log.warn("sync: resync_required send failed", {
            orgId,
            clientId: handshake.clientId,
            err: err instanceof Error ? err.message : String(err),
          }),
        );
    }

    // Spec 111 §2.3 Phase 3 (amended by spec 119) — post-handshake catalog
    // directory spans every project in the session's org. Sent to every
    // connecting OPC so a desktop that missed incremental updates can diff
    // hashes against its local cache and pull only what changed.
    // Fire-and-log: a DB hiccup here must not stop the duplex session.
    void sendAgentCatalogSnapshot(orgId, handshake.clientId).catch((err) => {
      log.warn("sync: agent.catalog.snapshot post-handshake send failed", {
        orgId,
        clientId: handshake.clientId,
        err: err instanceof Error ? err.message : String(err),
      });
    });

    // Spec 112 Phase 8 (amended by spec 119) — post-handshake project list,
    // one upsert per row across the org so the OPC's Projects panel renders
    // without a follow-up round-trip. Same fire-and-log posture as the
    // agent snapshot above.
    void sendProjectCatalogSnapshot(orgId, handshake.clientId).catch((err) => {
      log.warn("sync: project.catalog snapshot post-handshake send failed", {
        orgId,
        clientId: handshake.clientId,
        err: err instanceof Error ? err.message : String(err),
      });
    });

    // Spec 123 §7.2 — post-handshake project agent binding snapshots, one
    // per project in the org. Sent independently of the catalog snapshot so
    // a desktop with a partial project membership delta can apply binding
    // state without rebuilding its catalog cache. Fire-and-log per snapshot.
    void (async () => {
      try {
        const projectIds = await listProjectIdsForOrg(orgId);
        for (const projectId of projectIds) {
          await sendProjectAgentBindingSnapshot(
            orgId,
            projectId,
            handshake.clientId,
          ).catch((err) => {
            log.warn(
              "sync: project.agent_binding.snapshot post-handshake send failed",
              {
                orgId,
                projectId,
                clientId: handshake.clientId,
                err: err instanceof Error ? err.message : String(err),
              },
            );
          });
        }
      } catch (err) {
        log.warn(
          "sync: failed to enumerate projects for binding snapshot",
          {
            orgId,
            clientId: handshake.clientId,
            err: err instanceof Error ? err.message : String(err),
          },
        );
      }
    })();

    // Start a heartbeat so idle connections surface half-open sockets.
    let heartbeatAlive = true;
    const heartbeatTimer = setInterval(() => {
      registry
        .sendTo(orgId, handshake.clientId, {
          kind: "sync.heartbeat",
          meta: {
            v: ENVELOPE_SCHEMA_VERSION,
            eventId: randomUUID(),
            sentAt: new Date().toISOString(),
            orgId,
            orgCursor: cursors.peek(orgId) ?? "",
          },
        })
        .then((ok) => {
          if (!ok) heartbeatAlive = false;
        })
        .catch(() => {
          heartbeatAlive = false;
        });
    }, HEARTBEAT_INTERVAL_MS);

    try {
      for await (const msg of stream) {
        if (!heartbeatAlive) break;

        const result = await handleInbound(ctx, msg);

        const clientEventId =
          msg && typeof msg === "object" && "meta" in msg
            ? (msg as { meta?: { eventId?: string } }).meta?.eventId ?? ""
            : "";

        if (result.ok) {
          // Heartbeats and ACKs don't need their own ACK response.
          const silent =
            msg &&
            typeof msg === "object" &&
            "kind" in msg &&
            ((msg as { kind?: string }).kind === "sync.heartbeat" ||
              (msg as { kind?: string }).kind === "sync.ack");
          if (!silent && clientEventId) {
            await publishAck(ctx, clientEventId);
          }
        } else {
          await publishNack(ctx, clientEventId, result.reason, result.detail);
        }
      }
    } catch (err) {
      log.warn("sync: duplex stream error", {
        orgId,
        clientId: handshake.clientId,
        err: err instanceof Error ? err.message : String(err),
      });
    } finally {
      clearInterval(heartbeatTimer);
      // Pass our own `stream` so a reconnect that already replaced us under the
      // same clientId is not torn down by this (now-stale) connection's
      // teardown (spec 183 — duplex reconnect race).
      registry.unregister(orgId, handshake.clientId, stream);
    }
  },
);
