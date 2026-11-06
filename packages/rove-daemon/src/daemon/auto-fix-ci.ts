/**
 * Auto-fix CI runner: for each task that opted in (`Task.autoFixCi`), when the PR poller shows red checks on a
 * head sha not yet tried and the engine is at rest, type the fix-CI prompt (with the failing logs) into its
 * engine session. The rule is `autoFixDecision`; this file reads the world and applies the verdict.
 *
 *  - Stateless per tick, like quota-resume: the persisted `autoFixCi` is the whole memory, so a restart loses nothing.
 *  - Never interrupts: a busy engine only means "look again next tick" (the red sha stays untried).
 *  - A prompt that could not be read or delivered does not spend an attempt.
 *  - Ungated: unattended is the point.
 */

import { AUTO_FIX_MAX, type AutoFixState, autoFixDecision } from "../auto-fix-ci.ts"
import type { DaemonActivityRegistry } from "./activity-registry.ts"
import type { AttentionInboxStore } from "./attention-inbox.ts"
import type { DaemonOrchestrator, DaemonTask } from "./contracts.ts"
import { logDaemonError, logDaemonInfo } from "./crash-log.ts"
import { readFailingChecks } from "./pr-failing-checks.ts"
import { ptyScopeFor } from "./pty-alias.ts"
import type { DaemonRuntimeAdapter } from "./runtime.ts"
import { startTicker } from "./ticker.ts"

export const DEFAULT_AUTO_FIX_TICK_MS = 30_000

export interface AutoFixDeps {
  readonly orch: DaemonOrchestrator
  readonly runtime: Pick<DaemonRuntimeAdapter, "buildCIPrompt" | "deliverPromptToLiveEngineDetailed">
  readonly activity: Pick<DaemonActivityRegistry, "stateOf">
  readonly inbox?: Pick<AttentionInboxStore, "record">
  /** `gh` reads; injectable for tests. */
  readonly readChecks?: typeof readFailingChecks
}

/** Tasks the loop may act on. A task being deleted or archived is left alone. */
export function autoFixTasks(tasks: readonly DaemonTask[]): DaemonTask[] {
  return tasks.filter((task) => task.autoFixCi && task.worktreePath && !task.deletion && !task.archived)
}

/** True while the PR poller has a reason to run for an opted-in task (an open PR), awake or not. */
export function needsPrPoll(tasks: readonly DaemonTask[]): boolean {
  return autoFixTasks(tasks).some((task) => {
    const life = task.prStatus?.lifecycle
    return life === "open" || life === "ready_to_merge" || life === "unknown" || task.prStatus === undefined
  })
}

async function fixOne(deps: AutoFixDeps, task: DaemonTask): Promise<void> {
  const state = task.autoFixCi as AutoFixState
  const pr = task.prStatus
  const verdict = autoFixDecision({ state, pr, engine: deps.activity.stateOf(task.id, null) })
  if (verdict.do === "skip" || verdict.do === "wait") return
  if (verdict.do === "reset") {
    await deps.orch.setAutoFixCi(task.id, { attempts: 0 })
    logDaemonInfo("auto-fix-ci", `task=${task.id} checks passing, count reset`)
    return
  }
  if (verdict.do === "stop") {
    await deps.orch.setAutoFixCi(task.id, { ...state, stopped: true })
    await deps.inbox
      ?.record(
        task.id,
        "turn-failed",
        { failure: "other", note: `auto-fix CI stopped after ${AUTO_FIX_MAX} attempts — the checks are still failing` },
        null,
      )
      .catch((err) => logDaemonError("auto-fix-ci", err))
    logDaemonInfo("auto-fix-ci", `task=${task.id} stopped at ${AUTO_FIX_MAX} attempts`)
    return
  }
  const prNumber = pr?.number
  const headSha = pr?.headSha
  if (typeof prNumber !== "number" || !headSha || !task.worktreePath) return
  const read = await (deps.readChecks ?? readFailingChecks)({ worktreePath: task.worktreePath, prNumber })
  // `gh` not answering, or nothing red any more: try again next tick, nothing is spent.
  if (read.unavailable || read.checks.length === 0) return
  const next: AutoFixState = { attempts: state.attempts + 1, lastSha: headSha }
  const prompt = await deps.runtime.buildCIPrompt(task.worktreePath, {
    branch: task.branch || "HEAD",
    prNumber,
    checks: read.checks,
    totalFailing: read.totalFailing,
  })
  // Recorded before the paste so an overlapping tick cannot type it twice; undone if nothing took it.
  await deps.orch.setAutoFixCi(task.id, next)
  const sent = await deps.runtime
    .deliverPromptToLiveEngineDetailed(
      {
        id: task.id,
        vendor: task.vendor,
        command: task.command,
        worktreePath: task.worktreePath,
        scope: ptyScopeFor(deps.orch.listTasks(), task.id),
      },
      `[auto-fix CI ${next.attempts}/${AUTO_FIX_MAX}] ${prompt}`,
    )
    .catch((err) => {
      logDaemonError("auto-fix-ci", err)
      return null
    })
  if (sent?.outcome !== "delivered") {
    await deps.orch.setAutoFixCi(task.id, state)
    logDaemonInfo("auto-fix-ci", `task=${task.id} no live engine to take the prompt; attempt not spent`)
    return
  }
  logDaemonInfo(
    "auto-fix-ci",
    `task=${task.id} sent attempt ${next.attempts}/${AUTO_FIX_MAX} for ${headSha.slice(0, 8)}`,
  )
}

/** One pass over every opted-in task. */
export async function runAutoFixPass(deps: AutoFixDeps): Promise<void> {
  for (const task of autoFixTasks(deps.orch.listTasks())) {
    await fixOne(deps, task).catch((err) => logDaemonError("auto-fix-ci", err))
  }
}

export function startAutoFixRunner(deps: AutoFixDeps, tickMs: number = DEFAULT_AUTO_FIX_TICK_MS) {
  return startTicker({ name: "auto-fix-ci", tickMs, run: () => runAutoFixPass(deps) })
}
