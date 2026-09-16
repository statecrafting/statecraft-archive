import { api } from "encore.dev/api";
import { secret } from "encore.dev/config";
import log from "encore.dev/log";
import { Subscription } from "encore.dev/pubsub";
import {
  FactoryEventTopic,
  type FactoryPipelineEvent,
} from "../factory/events";

export interface NotifyParams {
  text: string; // the slack message to send
}

// Sends a Slack message to a pre-configured channel using a
// Slack Incoming Webhook (see https://api.slack.com/messaging/webhooks).
export const notify = api<NotifyParams>({}, async ({ text }) => {
  const url = webhookURL();
  if (!url) {
    log.info("no slack webhook url defined, skipping slack notification");
    return;
  }

  const resp = await fetch(url, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
  if (resp.status >= 400) {
    const body = await resp.text();
    throw new Error(`slack notification failed: ${resp.status}: ${body}`);
  }
});

// SLACK_WEBHOOK_URL defines the Slack webhook URL to send notifications to.
const webhookURL = secret("SLACK_WEBHOOK_URL");

// ---------------------------------------------------------------------------
// Factory Pipeline Notifications
// ---------------------------------------------------------------------------

function formatFactorySlackMessage(event: FactoryPipelineEvent): string | null {
  const pid = event.pipeline_id.slice(0, 8);
  switch (event.event_type) {
    case "pipeline_initialized":
      return `*Factory* Pipeline \`${pid}\` started (adapter: ${event.details?.adapter ?? "unknown"})`;
    case "stage_confirmed":
      return `*Factory* Stage \`${event.stage_id}\` confirmed by ${event.actor ?? "unknown"}`;
    case "stage_rejected":
      return `*Factory* Stage \`${event.stage_id}\` rejected by ${event.actor ?? "unknown"}: ${event.details?.feedback ?? ""}`;
    case "pipeline_completed":
      return `*Factory* Pipeline \`${pid}\` completed successfully`;
    case "pipeline_failed":
      return `*Factory* Pipeline \`${pid}\` failed: ${event.details?.error ?? "unknown error"}`;
    case "deployment_triggered":
      return `*Factory* Deployment triggered for pipeline \`${pid}\` to ${event.details?.environment ?? "unknown"}`;
    default:
      return null;
  }
}

const _factorySlack = new Subscription(
  FactoryEventTopic,
  "slack-factory-notification",
  {
    handler: async (event) => {
      const text = formatFactorySlackMessage(event);
      if (text) {
        await notify({ text });
      }
    },
  }
);
