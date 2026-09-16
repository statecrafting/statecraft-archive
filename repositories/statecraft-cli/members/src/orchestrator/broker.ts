// Spec 122: the action boundary (doc 04 §6, D50, D51). The push, the pull
// request and the merge are the engine's effects, performed by one broker
// that acts only on a receipt covering the head it is asked to publish, a
// lease the requesting run still holds, and text it has checked. Every
// effect is journaled before and after with the action, the target, the
// head and the receipt it consumed; a retry reconciles first and never
// repeats an effect that already happened.

import { WITHOUT_REPOSITORY_HOOKS } from "./candidate";
import type { JournalHandle, JournalRecord, JsonValue } from "./journal";
import { latestReceipt, receiptCovers, type FoldedReceipt } from "./receipt";
import { foldOrchestratorState } from "./state";
import { findForbiddenMarkers, type GitHubClient, type GitHubPr, type MergeMethod } from "./stages/ship";

export const ACTION_KIND = "broker.action";
export const REFUSED_KIND = "broker.refused";

export type BrokerAction = "push" | "openPr" | "merge";

export type BrokerRefusal =
  | "lease-lost"
  | "no-receipt"
  | "receipt-mismatch"
  | "forbidden-text"
  | "remote-diverged"
  | "pr-head-mismatch"
  | "pr-missing";

export class BrokerRefusedError extends Error {
  readonly action: BrokerAction;
  readonly refusal: BrokerRefusal;
  constructor(action: BrokerAction, refusal: BrokerRefusal, message: string) {
    super(message);
    this.name = "BrokerRefusedError";
    this.action = action;
    this.refusal = refusal;
  }
}

// --- requests and outcomes (B-2) ---------------------------------------------

export interface BrokerRequest {
  readonly runId: string;
  readonly specId: string;
  readonly branch: string;
  readonly headSha: string;
  // The receipt this publication consumes, by its record hash; the broker
  // folds it from the chain and refuses one that does not cover `headSha`.
  readonly receiptHash: string;
}

export interface OpenPrRequest extends BrokerRequest {
  readonly title: string;
  readonly body: string;
}

export interface MergeRequest extends BrokerRequest {
  readonly prNumber: number;
  readonly method: MergeMethod;
}

// `already`: the effect had happened before this call (a retry after a lost
// response); nothing was done. `done`: the effect was performed now.
export interface PushOutcome {
  readonly status: "done" | "already";
}

export interface OpenPrOutcome {
  readonly status: "done" | "already";
  readonly pr: GitHubPr;
}

export interface MergeOutcomeB {
  readonly status: "done" | "already";
  readonly mergeSha: string;
}

export interface Broker {
  push(request: BrokerRequest): PushOutcome;
  openPr(request: OpenPrRequest): OpenPrOutcome;
  merge(request: MergeRequest): MergeOutcomeB;
}

// --- the git push seam (B-3) --------------------------------------------------

export interface GitPush {
  // The remote's head for `branch`, or null when the branch is not there.
  remoteHead(branch: string): string | null;
  // Whether `ancestor` is reachable from `descendant` in the local repository.
  isAncestor(ancestor: string, descendant: string): boolean;
  push(branch: string): void;
}

function runSync(cwd: string, cmd: readonly string[]): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(cmd as string[], { cwd });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout).trim(),
    stderr: new TextDecoder().decode(result.stderr).trim(),
  };
}

// The production seam over the candidate directory (121 B-2). `cwd` is
// read at every call so a candidate reopened after the seam was built is
// the one pushed.
//
// 129 B-7: `ls-remote` and `push` are the two invocations that carry the one
// credential the broker exists to hold, so they run no repository hook: a
// `pre-push` in a tracked hooks directory is candidate-authored code, and
// under the daemon's environment it would run beside that credential. A
// project's pre-push checks therefore do not run on a brokered push; the
// gate, which ran fenced over the same head, is acceptance.
export function createProcessGitPush(cwd: () => string): GitPush {
  return {
    remoteHead(branch: string): string | null {
      const result = runSync(cwd(), ["git", ...WITHOUT_REPOSITORY_HOOKS, "ls-remote", "--heads", "origin", branch]);
      if (result.exitCode !== 0) throw new Error(`broker: git ls-remote failed: ${result.stderr}`);
      const line = result.stdout.split("\n").find((l) => l.length > 0);
      if (line === undefined) return null;
      return line.split(/\s+/)[0] ?? null;
    },
    isAncestor(ancestor: string, descendant: string): boolean {
      return runSync(cwd(), ["git", "merge-base", "--is-ancestor", ancestor, descendant]).exitCode === 0;
    },
    push(branch: string): void {
      const result = runSync(cwd(), ["git", ...WITHOUT_REPOSITORY_HOOKS, "push", "--set-upstream", "origin", branch]);
      if (result.exitCode !== 0) throw new Error(`broker: git push failed: ${result.stderr}`);
    },
  };
}

// --- the lease (B-4) -----------------------------------------------------------

// The run that may publish is the project's live run in the folded state
// (013): running or paused. Any other run id has lost the lease.
export function holdsLease(records: readonly JournalRecord[], runId: string): boolean {
  const state = foldOrchestratorState(records);
  const run = state.runs.get(runId);
  return run !== undefined && (run.status === "running" || run.status === "paused");
}

// --- the broker (B-2, B-5) ------------------------------------------------------

export interface CreateBrokerParams {
  readonly journal: JournalHandle;
  readonly gh: GitHubClient;
  readonly git: GitPush;
  // How a PR is created (B-3); the production one shells `gh pr create`
  // and reads the PR back through `gh`.
  readonly createPr?: (branch: string, title: string, body: string) => GitHubPr;
}

export function createBroker(params: CreateBrokerParams): Broker {
  const { journal, gh, git } = params;
  const createPr = params.createPr ?? ((branch, title, body) => gh.createPr(branch, title, body));

  function refuse(action: BrokerAction, refusal: BrokerRefusal, request: BrokerRequest, detail: string): never {
    const payload: Record<string, JsonValue> = {
      action,
      reason: refusal,
      runId: request.runId,
      specId: request.specId,
      target: request.branch,
      headSha: request.headSha,
      receiptHash: request.receiptHash,
      detail,
    };
    journal.append(REFUSED_KIND, payload);
    throw new BrokerRefusedError(action, refusal, `broker: ${action} refused (${refusal}): ${detail}`);
  }

  // The checks every action makes, in order: the lease, then the receipt.
  function admit(action: BrokerAction, request: BrokerRequest): FoldedReceipt {
    const records = journal.fold().records;
    if (!holdsLease(records, request.runId)) {
      refuse(action, "lease-lost", request, `run ${request.runId} is not the project's live run`);
    }
    const receipt = latestReceipt(records, request.specId);
    if (receipt === null) {
      refuse(action, "no-receipt", request, `no acceptance receipt for ${request.specId}`);
    }
    if (receipt.hash !== request.receiptHash) {
      refuse(action, "receipt-mismatch", request, `the newest receipt for ${request.specId} is ${receipt.hash}, not ${request.receiptHash}`);
    }
    if (!receiptCovers(receipt.receipt, request.headSha)) {
      refuse(
        action,
        "receipt-mismatch",
        request,
        `receipt ${receipt.hash} covers ${receipt.receipt.repo.candidateSha}, not ${request.headSha}`
      );
    }
    return receipt;
  }

  function intent(action: BrokerAction, request: BrokerRequest, target: string): void {
    const payload: Record<string, JsonValue> = {
      action,
      phase: "intent",
      runId: request.runId,
      specId: request.specId,
      target,
      headSha: request.headSha,
      receiptHash: request.receiptHash,
    };
    journal.append(ACTION_KIND, payload);
  }

  function outcome(action: BrokerAction, request: BrokerRequest, target: string, ok: boolean, detail: string): void {
    const payload: Record<string, JsonValue> = {
      action,
      phase: "outcome",
      runId: request.runId,
      specId: request.specId,
      target,
      headSha: request.headSha,
      receiptHash: request.receiptHash,
      ok,
      detail,
    };
    journal.append(ACTION_KIND, payload);
  }

  return {
    push(request: BrokerRequest): PushOutcome {
      admit("push", request);
      const remote = git.remoteHead(request.branch);
      if (remote === request.headSha) {
        outcome("push", request, request.branch, true, "already");
        return { status: "already" };
      }
      if (remote !== null && !git.isAncestor(remote, request.headSha)) {
        refuse("push", "remote-diverged", request, `origin/${request.branch} is at ${remote}, not an ancestor of ${request.headSha}`);
      }
      intent("push", request, request.branch);
      try {
        git.push(request.branch);
      } catch (err) {
        outcome("push", request, request.branch, false, (err as Error).message);
        throw err;
      }
      outcome("push", request, request.branch, true, "pushed");
      return { status: "done" };
    },

    openPr(request: OpenPrRequest): OpenPrOutcome {
      admit("openPr", request);
      const hits = [...findForbiddenMarkers(request.title).map((h) => `title contains ${h}`), ...findForbiddenMarkers(request.body).map((h) => `body contains ${h}`)];
      if (hits.length > 0) refuse("openPr", "forbidden-text", request, hits.join("; "));
      const existing = gh.prForBranch(request.branch);
      if (existing !== null) {
        if (existing.headSha !== request.headSha) {
          refuse("openPr", "pr-head-mismatch", request, `PR #${existing.number} is at ${existing.headSha}, not ${request.headSha}`);
        }
        outcome("openPr", request, `#${existing.number}`, true, "already");
        return { status: "already", pr: existing };
      }
      intent("openPr", request, request.branch);
      let pr: GitHubPr;
      try {
        pr = createPr(request.branch, request.title, request.body);
      } catch (err) {
        outcome("openPr", request, request.branch, false, (err as Error).message);
        throw err;
      }
      if (pr.headSha !== request.headSha) {
        outcome("openPr", request, `#${pr.number}`, false, `created at ${pr.headSha}, not ${request.headSha}`);
        refuse("openPr", "pr-head-mismatch", request, `PR #${pr.number} opened at ${pr.headSha}, not ${request.headSha}`);
      }
      outcome("openPr", request, `#${pr.number}`, true, "opened");
      return { status: "done", pr };
    },

    merge(request: MergeRequest): MergeOutcomeB {
      admit("merge", request);
      const pr = gh.prForBranch(request.branch);
      if (pr === null) refuse("merge", "pr-missing", request, `no pull request for ${request.branch}`);
      if (pr.merged === true && pr.mergeSha !== undefined) {
        outcome("merge", request, `#${request.prNumber}`, true, "already");
        return { status: "already", mergeSha: pr.mergeSha };
      }
      if (pr.headSha !== request.headSha) {
        refuse("merge", "pr-head-mismatch", request, `PR #${pr.number} is at ${pr.headSha}, not ${request.headSha}`);
      }
      intent("merge", request, `#${request.prNumber}`);
      let mergeSha: string;
      try {
        mergeSha = gh.mergePr(request.prNumber, request.method, request.headSha).mergeSha;
      } catch (err) {
        outcome("merge", request, `#${request.prNumber}`, false, (err as Error).message);
        throw err;
      }
      outcome("merge", request, `#${request.prNumber}`, true, mergeSha);
      return { status: "done", mergeSha };
    },
  };
}
