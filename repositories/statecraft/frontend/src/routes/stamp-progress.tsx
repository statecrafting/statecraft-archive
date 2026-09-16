import { useEffect, useState } from "react";
import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { factory, STAMP_TERMINAL, type StampJobView, type StampStatus } from "../lib/api";
import { formatDate, StatusBadge } from "../lib/ui";

// The happy-path pipeline in order (spec 005 state machine). "failed" is a
// terminal off-ramp reachable from any of these and is rendered separately.
const PIPELINE: StampStatus[] = ["queued", "stamping", "pushing", "verifying", "green"];

const POLL_MS = 2000;

function isTerminal(status: string): boolean {
  return (STAMP_TERMINAL as readonly string[]).includes(status);
}

export async function stampProgressLoader({ params }: LoaderFunctionArgs) {
  const job = await factory.job(params.jobId as string);
  return { job };
}

export function StampProgress() {
  const { job: initial } = useLoaderData() as { job: StampJobView };
  const [job, setJob] = useState<StampJobView>(initial);

  useEffect(() => {
    if (isTerminal(job.status)) return;
    const timer = setInterval(async () => {
      try {
        setJob(await factory.job(job.id));
      } catch {
        // Transient poll failure: keep the last known state and keep polling.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [job.id, job.status]);

  const failed = job.status === "failed";
  const currentIndex = PIPELINE.indexOf(job.status as StampStatus);

  return (
    <section>
      <p className="breadcrumb">
        <Link to="/">Tenants</Link> /{" "}
        <Link to={`/tenants/${job.tenantId}`}>tenant</Link> / stamp
      </p>
      <div className="page-head">
        <h1>{job.appName}</h1>
        <StatusBadge status={job.status} />
      </div>

      <div className="card">
        <dl className="kv">
          <dt>org</dt>
          <dd>{job.org}</dd>
          <dt>posture</dt>
          <dd>{job.posture}</dd>
          <dt>template</dt>
          <dd>
            <code>{job.templateRef}</code> (contract {job.contractVersion})
          </dd>
          <dt>started</dt>
          <dd>{formatDate(job.createdAt)}</dd>
          <dt>updated</dt>
          <dd>{formatDate(job.updatedAt)}</dd>
        </dl>
      </div>

      <ol className="stepper">
        {PIPELINE.map((state, i) => {
          let cls = "step";
          if (failed) {
            cls += i <= Math.max(currentIndex, 0) ? " done" : "";
          } else if (i < currentIndex) {
            cls += " done";
          } else if (i === currentIndex) {
            cls += " current";
          }
          return (
            <li key={state} className={cls}>
              {state}
            </li>
          );
        })}
        {failed && <li className="step failed">failed</li>}
      </ol>

      {failed && job.error && (
        <div className="banner bad">
          <strong>Stamp failed.</strong> {job.error}
        </div>
      )}

      {job.status === "green" && (
        <div className="card">
          <p>
            Stamp complete. The born-with provenance cert is minted and the repo pushed to{" "}
            <code>{job.org}</code>.
          </p>
          <dl className="kv">
            {job.certHash && (
              <>
                <dt>cert hash</dt>
                <dd>
                  <code>{job.certHash}</code>
                </dd>
              </>
            )}
            {job.checksRunId && (
              <>
                <dt>checks run</dt>
                <dd>
                  <code>{job.checksRunId}</code>
                </dd>
              </>
            )}
          </dl>
        </div>
      )}

      {!isTerminal(job.status) && (
        <p className="hint">Live: polling every {POLL_MS / 1000}s...</p>
      )}
    </section>
  );
}
