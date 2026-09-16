/**
 * POST /github/webhook (spec 004 §3): GitHub App event receipt.
 *
 * HMAC-verified with the webhook secret (constant-time compare over the raw
 * bytes) before anything else; a bad or missing signature is rejected 401. We
 * act only on `installation` events, mapping the action to a lifecycle status
 * on a KNOWN installation. An installation we never bound to a tenant is logged
 * and ignored (there is nothing to attach it to). Every other event: 204,
 * logged and ignored.
 */
import { api } from "encore.dev/api";

import { logInfo, logSecurityEvent, logWarn } from "../lib/logger";

import { autoProvisionFromInstall } from "./access/provision";
import { githubWebhookSecret } from "./config";
import type { InstallationStatus } from "./entities";
import { endText, readRawBody } from "./http";
import { verifyWebhookSignature } from "./signature";
import { setInstallationStatus } from "./store";

function statusForAction(action: string): InstallationStatus | null {
  switch (action) {
    case "created":
    case "unsuspend":
      return "active";
    case "suspend":
      return "suspended";
    case "deleted":
      return "removed";
    default:
      return null;
  }
}

interface InstallationEvent {
  action?: unknown;
  installation?: { id?: unknown; account?: { login?: unknown } };
  sender?: { id?: unknown; login?: unknown };
}

export const webhook = api.raw(
  { expose: true, method: "POST", path: "/github/webhook" },
  async (req, res) => {
    const raw = await readRawBody(req);
    const sigHeader = req.headers["x-hub-signature-256"];
    const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
    if (!verifyWebhookSignature(raw, signature, githubWebhookSecret())) {
      logSecurityEvent("github.webhook.bad_signature");
      endText(res, 401, "invalid signature");
      return;
    }

    const eventHeader = req.headers["x-github-event"];
    const event = Array.isArray(eventHeader) ? eventHeader[0] : eventHeader;
    if (event !== "installation") {
      res.statusCode = 204;
      res.end();
      return;
    }

    let payload: InstallationEvent;
    try {
      payload = JSON.parse(raw.toString("utf8")) as InstallationEvent;
    } catch {
      res.statusCode = 204;
      res.end();
      return;
    }

    const action = typeof payload.action === "string" ? payload.action : "";
    const rawId = payload.installation?.id;
    const installationId = rawId != null ? String(rawId) : "";
    const status = statusForAction(action);
    if (!installationId || !status) {
      res.statusCode = 204;
      res.end();
      return;
    }

    const updated = await setInstallationStatus(installationId, status);
    if (updated) {
      logInfo("tenants.installation_status_updated", { installationId, status, action });
    } else if (action === "created") {
      // Direct install from GitHub's App page (no app-side state): auto-create a
      // tenant and a pending admin membership keyed by the installer (spec 011 §5.6).
      const githubOrg =
        typeof payload.installation?.account?.login === "string"
          ? payload.installation.account.login
          : "";
      const senderGithubId = payload.sender?.id != null ? String(payload.sender.id) : "";
      await autoProvisionFromInstall({ installationId, githubOrg, senderGithubId });
      logInfo("tenants.installation_auto_provisioned", { installationId, githubOrg });
    } else {
      logWarn("tenants.installation_unknown", { installationId, action });
    }
    res.statusCode = 204;
    res.end();
  },
);
