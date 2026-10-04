/**
 * Daemon-side status rules (docs/design/web-kanban.md M5). `turn-start` on a
 * `backlog` task unambiguously means work began, so a pure rule moves it to
 * `in_progress`; in_progress → in_review is the agent's own self-report via
 * the injected status protocol (engine/worktree-protocol.ts
 * `withWorktreeProtocol`).
 *
 * The ONLY transition made is `backlog → in_progress`; a card the user put
 * elsewhere is never touched, so dragging it back to Backlog sticks until the
 * engine's next turn starts. Opt-in via `experimental.autoStatus`, read per event.
 */

import { autoStatusEnabled } from "@/state/auto-status"
import type { Task, TaskStatus } from "@/types/task"

/** The minimal (structural) orchestrator surface the rule needs. */
export interface StatusRuleOrchestrator {
  getTask(id: string): Task | undefined
  setStatus(id: string, status: TaskStatus): Promise<void>
}

export type AutoStatusResult = "moved" | "skipped"

/**
 * `turn-start` rule: a backlog task whose engine starts working moves to
 * `in_progress`. Pure field checks — no git, no model, no transcript.
 */
export async function maybeAutoStart(
  orch: StatusRuleOrchestrator,
  taskId: string,
  enabled: () => boolean = autoStatusEnabled,
): Promise<AutoStatusResult> {
  if (!enabled()) return "skipped"
  const task = orch.getTask(taskId)
  if (!task) return "skipped"
  if ((task.kind ?? "task") === "main") return "skipped"
  if (task.status !== "backlog") return "skipped"
  await orch.setStatus(taskId, "in_progress")
  return "moved"
}
