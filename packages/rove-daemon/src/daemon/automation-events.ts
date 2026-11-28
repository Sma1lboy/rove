/**
 * Daemon-side event triggers for Routines:
 *   - Reuses the PR status poller's `TaskPRStatus` updates via `orch.subscribeTasks`
 *     to detect `ci_failed` and `pr_review_requested` transitions (seeded on boot so
 *     existing red/review PRs never cause a restart stampede).
 *   - Evaluates webhook trigger filters for `/hooks/routines/<id>`.
 *   - Dispatches local / emitted events (`automation.emitEvent`) to matching routines.
 */

import { samePath } from "../path-identity.ts"
import {
  type AutomationEventTrigger,
  type AutomationTriggerEvent,
  globMatch,
  matchEventFilter,
  matchEventTrigger,
} from "./automation-event-contracts.ts"
import { type RunnerDeps, runAutomationOnce } from "./automation-runner.ts"
import type { WebhookEvent } from "./automation-webhook.ts"
import type { Automation, AutomationRunStatus, DaemonOrchestrator, DaemonTask, TaskPRStatus } from "./contracts.ts"
import { logDaemonError, logDaemonInfo } from "./crash-log.ts"
import type { DaemonEventBus } from "./event-bus.ts"

const PR_POLLED_KINDS = new Set(["ci_failed", "pr_review_requested"])
const FAILING_CONCLUSIONS = new Set(["failure", "timed_out", "action_required", "startup_failure"])

/** True when any enabled routine listens to PR-poller-backed events (`ci_failed` / `pr_review_requested`). */
export function hasPrEventRoutine(automations: readonly Automation[]): boolean {
  return automations.some((a) => a.enabled && a.eventTriggers?.some((t) => PR_POLLED_KINDS.has(t.kind)))
}

function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

/**
 * True when an incoming GitHub webhook matches at least one configured event trigger on a routine.
 * Routines with `webhook` and NO `eventTriggers` bypass this check (legacy catch-all behavior).
 */
export function webhookMatchesTriggers(
  triggers: readonly AutomationEventTrigger[],
  event: WebhookEvent,
  rawBody: string,
): boolean {
  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    payload = undefined
  }
  const conclusion = (
    text(field(field(payload, "check_run"), "conclusion")) ??
    text(field(field(payload, "check_suite"), "conclusion")) ??
    text(field(field(payload, "workflow_run"), "conclusion")) ??
    ""
  ).toLowerCase()
  const statusState = (text(field(payload, "state")) ?? "").toLowerCase()
  const reviewState = (text(field(field(payload, "review"), "state")) ?? "").toLowerCase()

  return triggers.some((trigger) => {
    switch (trigger.kind) {
      case "webhook":
        return matchEventFilter(trigger.filter, event)
      case "issue_opened": {
        if (event.name !== "issues") return false
        const wantedAction = trigger.filter?.action ?? "opened"
        if (!event.action || !globMatch(wantedAction, event.action)) return false
        return trigger.filter?.branch ? Boolean(event.branch && globMatch(trigger.filter.branch, event.branch)) : true
      }
      case "pr_review_requested": {
        const isRequested = event.name === "pull_request" && event.action === "review_requested"
        const isChanges =
          event.name === "pull_request_review" && event.action === "submitted" && reviewState === "changes_requested"
        if (!isRequested && !isChanges) return false
        return matchEventFilter(
          trigger.filter ? { ...trigger.filter, event: undefined, action: undefined } : undefined,
          event,
        )
      }
      case "ci_failed": {
        const isCheck =
          (event.name === "check_run" || event.name === "check_suite" || event.name === "workflow_run") &&
          event.action === "completed" &&
          FAILING_CONCLUSIONS.has(conclusion)
        const isStatus = event.name === "status" && (statusState === "failure" || statusState === "error")
        if (!isCheck && !isStatus) return false
        return matchEventFilter(
          trigger.filter ? { ...trigger.filter, event: undefined, action: undefined } : undefined,
          event,
        )
      }
      case "local":
        return false
    }
  })
}

/** True when `automation` matches `event` (enabled, repo scope, and at least one event trigger). */
export function automationMatchesEvent(
  automation: Automation,
  event: AutomationTriggerEvent,
  targetId?: string,
): boolean {
  if (!automation.enabled) return false
  if (targetId && automation.id !== targetId) return false
  if (!automation.eventTriggers?.length) return false
  if (automation.repo && event.repo && !samePath(automation.repo, event.repo)) return false
  return automation.eventTriggers.some((trigger) => matchEventTrigger(trigger, event))
}

export interface EmittedRunResult {
  readonly automationId: string
  readonly name: string
  readonly status: AutomationRunStatus
}

/** Fire every enabled routine matching `event`. */
export async function dispatchAutomationEvent(
  deps: RunnerDeps,
  event: AutomationTriggerEvent,
  opts?: { readonly automationId?: string },
): Promise<EmittedRunResult[]> {
  const now = deps.now ?? Date.now
  const matches = deps.store.list().filter((a) => automationMatchesEvent(a, event, opts?.automationId))
  const results: EmittedRunResult[] = []
  for (const automation of matches) {
    const status = await runAutomationOnce(deps, automation, {
      scheduledFor: now(),
      trigger: "event",
      event,
    })
    results.push({ automationId: automation.id, name: automation.name, status })
  }
  return results
}

/** Observed PR snapshot used to detect transitions without re-firing on unchanged polls. */
export interface ObservedPrState {
  readonly checkState: TaskPRStatus["checkState"]
  readonly headSha?: string
  readonly reviewDecision?: string
  readonly lifecycle: TaskPRStatus["lifecycle"]
}

interface TrackedPr {
  readonly key: string
  readonly repo: string
  readonly branch?: string
  readonly pr: TaskPRStatus
}

function trackedPrsOf(tasks: readonly DaemonTask[]): TrackedPr[] {
  const out: TrackedPr[] = []
  for (const task of tasks) {
    if (task.deletion || task.archived) continue
    if (task.prStatus) {
      out.push({ key: `${task.id}::primary`, repo: task.repo, branch: task.branch, pr: task.prStatus })
    }
    for (const extra of task.extraRepos ?? []) {
      if (extra.prStatus) {
        out.push({
          key: `${task.id}::extra::${extra.name}`,
          repo: extra.repo,
          branch: extra.branch,
          pr: extra.prStatus,
        })
      }
    }
    for (const sessionPr of task.sessionPrs ?? []) {
      if (sessionPr.status) {
        out.push({ key: `${task.id}::session::${sessionPr.url}`, repo: task.repo, pr: sessionPr.status })
      }
    }
  }
  return out
}

/**
 * Diff the live task list's PR statuses against `observed` and emit transition events.
 * Mutates `observed` in place and prunes keys whose tasks/PRs disappeared.
 * `seedOnly: true` records the baseline on daemon boot without emitting events.
 */
export function extractPrTriggerEvents(
  observed: Map<string, ObservedPrState>,
  tasks: readonly DaemonTask[],
  seedOnly = false,
): AutomationTriggerEvent[] {
  const tracked = trackedPrsOf(tasks)
  const liveKeys = new Set(tracked.map((item) => item.key))
  for (const key of observed.keys()) {
    if (!liveKeys.has(key)) observed.delete(key)
  }

  const events: AutomationTriggerEvent[] = []
  for (const { key, repo, branch, pr } of tracked) {
    const prev = observed.get(key)
    observed.set(key, {
      checkState: pr.checkState,
      ...(pr.headSha ? { headSha: pr.headSha } : {}),
      ...(pr.reviewDecision ? { reviewDecision: pr.reviewDecision } : {}),
      lifecycle: pr.lifecycle,
    })
    if (seedOnly) continue

    const open = pr.lifecycle === "open" || pr.lifecycle === "ready_to_merge" || pr.lifecycle === "unknown"
    if (!open) continue

    const prRef = typeof pr.number === "number" ? `PR #${pr.number}` : "PR"
    const shaShort = pr.headSha ? ` (${pr.headSha.slice(0, 7)})` : ""
    const branchPart = branch ? ` on ${branch}` : ""
    const urlPart = pr.url ? ` ${pr.url}` : ""

    // Fire `ci_failed` when checks transition to failing, or fail on a new head commit.
    const ciTransitioned =
      pr.checkState === "failing" &&
      (prev?.checkState !== "failing" || (Boolean(pr.headSha) && prev?.headSha !== pr.headSha))
    if (ciTransitioned) {
      events.push({
        kind: "ci_failed",
        name: "ci_failed",
        action: "failing",
        repo,
        ...(branch ? { branch } : {}),
        ...(pr.url ? { url: pr.url } : {}),
        summary: `ci_failed ${prRef}${branchPart}${shaShort}${urlPart}`.trim(),
      })
    }

    // Fire `pr_review_requested` when reviewDecision enters REVIEW_REQUIRED or CHANGES_REQUESTED.
    const decision = (pr.reviewDecision ?? "").toUpperCase()
    const reviewWanted = decision === "REVIEW_REQUIRED" || decision === "CHANGES_REQUESTED"
    const reviewTransitioned =
      reviewWanted &&
      ((prev?.reviewDecision ?? "").toUpperCase() !== decision ||
        (decision === "CHANGES_REQUESTED" && Boolean(pr.headSha) && prev?.headSha !== pr.headSha))
    if (reviewTransitioned) {
      const action = decision.toLowerCase()
      events.push({
        kind: "pr_review_requested",
        name: "pr_review_requested",
        action,
        repo,
        ...(branch ? { branch } : {}),
        ...(pr.url ? { url: pr.url } : {}),
        summary: `pr_review_requested ${prRef} (${action})${branchPart}${urlPart}`.trim(),
      })
    }
  }
  return events
}

/**
 * Subscribe to the daemon event bus's `task.snapshot` channel (updated by the PR poller)
 * and fire matching `ci_failed` / `pr_review_requested` routines. Subscribing to `bus`
 * instead of `orch.subscribeTasks` keeps one single orchestrator listener in `server.ts`.
 */
export function startAutomationEventWatcher(
  orch: Pick<DaemonOrchestrator, "listTasks">,
  bus: Pick<DaemonEventBus, "onPublish">,
  deps: RunnerDeps,
): () => void {
  const observed = new Map<string, ObservedPrState>()
  extractPrTriggerEvents(observed, orch.listTasks(), true)
  let stopped = false
  const unsubscribe = bus.onPublish((published) => {
    if (stopped || published.channel !== "task.snapshot") return
    const tasks = (published.payload as { readonly tasks?: readonly DaemonTask[] })?.tasks
    if (!Array.isArray(tasks)) return
    const events = extractPrTriggerEvents(observed, tasks, false)
    if (events.length === 0) return
    for (const event of events) {
      logDaemonInfo("automation-event", event.summary)
      void dispatchAutomationEvent({ ...deps, stopped: () => stopped }, event).catch((err) =>
        logDaemonError("automation-event", err),
      )
    }
  })
  return () => {
    stopped = true
    unsubscribe()
  }
}
