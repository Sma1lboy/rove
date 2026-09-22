/**
 * `engine.reportEvent`: a hook (or `rove api engine-report`) reports a
 * NORMALIZED engine activity event, folded into activity state, the inbox,
 * the events feed, plugin hooks, turn telemetry, status rules, and quota resume.
 */

import { ingestAgentTurnsBestEffort } from "./agent-turns-ingest.ts"
import { logDaemonError } from "./crash-log.ts"
import { findAdoptableWorktree, matchTaskByCwd } from "./cwd-task.ts"
import { optionalActivityDetail, optionalString, requireString } from "./handler-validators.ts"
import type { DaemonRequestHandler } from "./handlers.ts"
import { scheduleQuotaResume } from "./quota-resume.ts"

export const ENGINE_REPORT_HANDLER: DaemonRequestHandler = {
  name: "engine.reportEvent",
  async handle(payload, ctx) {
    // Global hooks carry no task id; their `cwd` maps to a task by worktree
    // path, and an unmatched cwd is silently dropped.
    const kind = requireString(payload, "kind")
    // `CODE: ` message prefix so a mistyped kind reads BAD_EVENT_KIND, not a
    // bare RPC_ERROR. `rove api engine-report` rejects it earlier, at the flag.
    if (!ctx.runtime.isEngineActivityKind(kind)) throw new Error(`BAD_EVENT_KIND: unknown engine event kind: ${kind}`)
    // `taskId` (legacy/direct) wins; otherwise resolve from `cwd`.
    const explicitId = optionalString(payload, "taskId")
    const cwd = optionalString(payload, "cwd")
    // A session starting in an unadopted worktree under a tracked repo's
    // managed root is auto-adopted so the cwd maps below. `session-start`
    // only, to bound the work; `adoptWorktree` is idempotent + git-validated.
    if (!explicitId && cwd && kind === "session-start") {
      const cand = findAdoptableWorktree(ctx.orch.listTasks(), cwd)
      if (cand) {
        try {
          await ctx.orch.adoptWorktree({ repo: cand.repo, worktreePath: cand.worktreePath, ifExists: "return" })
        } catch (err) {
          logDaemonError("worktree-autosync", err)
        }
      }
    }
    const taskId = explicitId ?? (cwd ? matchTaskByCwd(ctx.orch.listTasks(), cwd) : undefined)
    if (!taskId) return {} // unmatched cwd → drop
    const detail = optionalActivityDetail(payload)
    // The inherited KOBE_TAB_ID.
    const tabId = optionalString(payload, "tabId")
    // From the hook payload; an old hook omits it.
    const sessionId = optionalString(payload, "sessionId")
    const transcriptPath = optionalString(payload, "transcriptPath")
    const session = sessionId ? { id: sessionId, transcriptPath } : undefined
    // Lifecycle-only kinds (tool/compact/subagent) skip badge + inbox, or every
    // tool call would broadcast to every client. They still reach plugins.
    const isStateKind = ctx.runtime.affectsActivityState(kind)
    // The hook's `--engine` tag: the liveness probe must ask the engine that
    // reported (a custom wrapper id as task.vendor has no transcript store).
    const vendor = optionalString(payload, "engine")
    if (isStateKind) {
      ctx.activity.report(taskId, kind, detail, tabId, session, vendor)
      // No tab id still records at TASK level (bare-shell engines). Only an
      // explicit id records: a cwd-matched task is a guess, not an identity.
      if (explicitId) {
        await ctx.inbox
          .record(taskId, kind, detail, tabId ?? null)
          .catch((err) => logDaemonError("attention-inbox-record", err))
      }
    }
    ctx.engineEvents?.append(taskId, {
      kind,
      ...(tabId ? { tabId } : {}),
      ...(vendor ? { vendor } : {}),
      ...(detail ? { detail } : {}),
      at: Date.now(),
    })
    if (kind === "pre-compact" || kind === "post-compact" || kind === "subagent-start" || kind === "subagent-stop") {
      ctx.bus.publish("engine.lifecycle", { taskId, kind, ...(tabId ? { tabId } : {}), at: Date.now() })
    }
    // docs/design/plugin-events.md. `turn-complete` is deferred below so it
    // can carry the finished turn's usage/model off the ingest.
    const pluginReport = {
      kind,
      taskId,
      ...(detail ? { detail: detail as unknown as Record<string, unknown> } : {}),
      ...(vendor ? { vendor } : {}),
      ...(tabId ? { tabId } : {}),
      ...(sessionId ? { sessionId } : {}),
    }
    if (kind !== "turn-complete") ctx.plugins?.handleEngineReport(pluginReport)
    // A finished turn's records are complete on disk. Fire-and-forget: the
    // read must not delay the hook RPC. The plugin event rides the callback,
    // which fires with or without a readable turn.
    if (kind === "turn-complete") {
      ingestAgentTurnsBestEffort(
        ctx.agentTurns,
        ctx.runtime,
        ctx.orch,
        {
          taskId,
          ...(tabId ? { tabId } : {}),
          ...(vendor ? { vendor } : {}),
          ...(transcriptPath ? { transcriptPath } : {}),
        },
        (latest) =>
          ctx.plugins?.handleEngineReport(
            latest ? { ...pluginReport, detail: { ...(pluginReport.detail ?? {}), turn: latest } } : pluginReport,
          ),
      )
    }
    // A turn starting on a backlog task advances it to in_progress (opt-in
    // state.json flag, checked inside maybeAutoStart). in_review is the
    // agent's own self-report, not a daemon rule.
    if (kind === "turn-start") {
      ctx.runtime
        .maybeAutoStart(ctx.orch, taskId)
        .then((result) => {
          if (result === "moved") {
            console.log(`[status-rules] task ${taskId} auto-moved backlog → in_progress`)
          }
        })
        .catch((err) => logDaemonError("status-rules", err))
      // A turn started, so any pending auto-resume is stale.
      if (ctx.orch.getTask(taskId)?.quotaResume) {
        void ctx.orch.setQuotaResume(taskId, null).catch((err) => logDaemonError("quota-resume", err))
      }
    }
    // Arm auto-resume at the quota reset. Fire-and-forget (network probe).
    // `billing` is excluded: it needs a human, not a timer.
    if (kind === "turn-failed" && detail?.failure === "rate_limit") {
      void scheduleQuotaResume(
        ctx.orch,
        ctx.runtime,
        ctx.quotaUsage,
        taskId,
        undefined,
        () => ctx.plugins ?? null,
      ).catch((err) => logDaemonError("quota-resume", err))
    }
    return {}
  },
}
