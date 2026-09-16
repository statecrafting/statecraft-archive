// Spec 114 §5.2 — PubSub topic for queued clone runs.
//
// The sync endpoint inserts a `project_clone_runs` row, then publishes
// the run id here. The subscription worker (cloneWorker.ts) loads the
// row, CAS-transitions pending → running, and runs the heavy work.

import { Topic } from "encore.dev/pubsub";

export interface ProjectCloneRequest {
  cloneJobId: string;
}

export const ProjectCloneRequestTopic = new Topic<ProjectCloneRequest>(
  "project-clone-request",
  {
    deliveryGuarantee: "at-least-once",
  },
);
