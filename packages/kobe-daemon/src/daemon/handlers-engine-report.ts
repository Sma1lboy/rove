/**
 * `engine.reportEvent` — the busiest RPC, split from `handlers.ts` (file-size
 * cap). A `kobe hook <verb>` (or `rove api engine-report`) process reports a
 * NORMALIZED engine activity event; this handler folds it into activity
 * state, the attention inbox, the recent-events feed, plugin event hooks,
 * turn telemetry, auto-status rules, and quota auto-resume.
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
    // A `kobe hook <verb>` process reporting a NORMALIZED engine activity
    // event (the vendor-specific hook was already translated by the
    // engine's hook adapter). The global hooks carry no task id — they
    // report their `cwd`, which we map to a task by worktree path. Fold it
    // into the task's transient activity state + broadcast on
    // `engine-state`. Unknown kinds are ignored (forward-compat: a newer
    // adapter, older daemon); an unmatched cwd (an unrelated repo, a
    // project with no kobe task) is silently dropped.
    const kind = requireString(payload, "kind")
    if (!ctx.runtime.isEngineActivityKind(kind)) throw new Error(`unknown engine event kind: ${kind}`)
    // `taskId` (legacy/direct) wins; otherwise resolve from `cwd`.
    const explicitId = optionalString(payload, "taskId")
    const cwd = optionalString(payload, "cwd")
    // External-worktree sync (replaces the removed WorktreeCreate hook): a
    // session starting in an unadopted worktree under a tracked repo's
    // a managed worktree root is auto-adopted as a task, so the cwd then maps
    // to it below. Gated to `session-start` to bound the work; the path
    // check is git-free and `adoptWorktree` is idempotent + git-validated
    // (a bogus dir just throws → caught → dropped).
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
    // Which engine tab the event came from — the inherited KOBE_TAB_ID env.
    // Sessions outside a Kobe tab remain activity-only via the report below.
    const tabId = optionalString(payload, "tabId")
    // The engine's own session identity, from its hook payload (Claude
    // pipes session_id/transcript_path). Optional + additive: an old
    // `kobe hook` simply omits it.
    const sessionId = optionalString(payload, "sessionId")
    const transcriptPath = optionalString(payload, "transcriptPath")
    const session = sessionId ? { id: sessionId, transcriptPath } : undefined
    // Lifecycle-only kinds (tool/compact/subagent) skip the badge + inbox
    // entirely — folding them into engine-state would broadcast every
    // tool call to every client. They still reach plugins below.
    const isStateKind = ctx.runtime.affectsActivityState(kind)
    // The hook's `--engine` tag — read early so the activity registry's
    // liveness probe can ask about the engine that actually reported
    // (a custom wrapper id as task.vendor has no transcript store).
    const vendor = optionalString(payload, "engine")
    if (isStateKind) {
      ctx.activity.report(taskId, kind, detail, tabId, session, vendor)
      // A tab id makes the episode tab-precise; without one it is still
      // recorded at TASK level (owner call 2026-08-10) — an engine the
      // user typed into a bare shell inherits no KOBE_TAB_ID, and
      // dropping its events is why such a session could finish without
      // ever appearing in the Inbox. `explicitId` still gates: a
      // cwd-matched task is a guess, not an identity.
      if (explicitId) {
        await ctx.inbox
          .record(taskId, kind, detail, tabId ?? null)
          .catch((err) => logDaemonError("attention-inbox-record", err))
      }
    }
    // Per-task recent-events buffer (TUI event feed) + the low-frequency
    // `engine.lifecycle` channel (sidebar compaction glyph / subagent mark).
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
    // Plugin event hooks: every report becomes one agent-lifecycle event
    // (docs/design/plugin-events.md); dispatch fans out only to plugins
    // that declared the event. `turn-complete` is deferred below so its
    // event can carry the finished turn's usage/model off the ingest.
    const pluginReport = {
      kind,
      taskId,
      ...(detail ? { detail: detail as unknown as Record<string, unknown> } : {}),
      ...(vendor ? { vendor } : {}),
      ...(tabId ? { tabId } : {}),
      ...(sessionId ? { sessionId } : {}),
    }
    if (kind !== "turn-complete") ctx.plugins?.handleEngineReport(pluginReport)
    // Per-turn telemetry (issue #32): a finished turn is the moment its
    // records are complete on disk. Fire-and-forget — the transcript read
    // must not delay the hook RPC, and losing a record is a telemetry
    // gap, never an engine failure. The turn.complete plugin event rides
    // the completion callback (fires with or without a readable turn).
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
    // Auto status flow (docs/design/web-kanban.md M5): an engine
    // STARTING a turn on a backlog task means work began — a pure rule
    // advances it to in_progress. (in_progress → in_review is the
    // agent's own self-report via the injected status protocol, not a
    // daemon rule.) Fire-and-forget; gated inside maybeAutoStart
    // (opt-in state.json flag).
    if (kind === "turn-start") {
      ctx.runtime
        .maybeAutoStart(ctx.orch, taskId)
        .then((result) => {
          if (result === "moved") {
            console.log(`[status-rules] task ${taskId} auto-moved backlog → in_progress`)
          }
        })
        .catch((err) => logDaemonError("status-rules", err))
      // A turn actually started (the user resumed manually, or our own
      // continue prompt landed) — any pending auto-resume is now stale.
      if (ctx.orch.getTask(taskId)?.quotaResume) {
        void ctx.orch.setQuotaResume(taskId, null).catch((err) => logDaemonError("quota-resume", err))
      }
    }
    // Real subscription-quota limit → ask the engine's quota probe when
    // the window resets and arm the durable auto-resume schedule.
    // Fire-and-forget: the probe does network I/O and must not delay the
    // hook RPC. `billing` is excluded — it needs a human, not a timer.
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
