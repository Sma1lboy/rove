import { realpath } from "node:fs/promises"
import type { Automation, AutomationPatch } from "./automation-contracts.ts"
import type { DaemonOrchestrator } from "./contracts.ts"

export type AutomationTarget =
  | { readonly kind: "fresh" }
  | { readonly kind: "standing"; readonly taskId?: string }
  | NonNullable<Automation["target"]>

export function automationTarget(automation: Automation): AutomationTarget {
  if (automation.target) return automation.target
  return automation.persistentSession ? { kind: "standing", taskId: automation.sessionTaskId } : { kind: "fresh" }
}

/** Absent retains the binding; null explicitly returns to task creation. */
export function readAutomationTarget(value: unknown): Automation["target"] | null {
  if (value === null) return null
  if (
    typeof value !== "object" ||
    !value ||
    !("kind" in value) ||
    value.kind !== "existing-tab" ||
    !("taskId" in value) ||
    typeof value.taskId !== "string" ||
    !value.taskId.trim() ||
    !("tabId" in value) ||
    typeof value.tabId !== "string" ||
    !/^tab-[\w-]+$/.test(value.tabId)
  )
    throw new Error("target must be { kind: 'existing-tab', taskId, tabId } or null")
  return { kind: "existing-tab", taskId: value.taskId.trim(), tabId: value.tabId }
}

export function assertAutomationTargetOptions(
  value: Pick<
    Automation,
    "target" | "vendor" | "model" | "modelEffort" | "baseRef" | "persistentSession" | "sessionTaskId"
  >,
): void {
  if (!value.target) {
    // Pins were validated against one engine; a vendor-less run would launch the default one.
    if ((value.model || value.modelEffort) && !value.vendor) {
      throw new Error("a routine that pins model or effort must also store the vendor they were validated against")
    }
    return
  }
  if (value.vendor || value.model || value.modelEffort || value.baseRef || value.persistentSession) {
    throw new Error(
      "an existing-tab target cannot set vendor, model, effort, baseRef or persistentSession; clear them when binding",
    )
  }
}

/** One merge policy for boundary validation and durable updates. */
export function mergeAutomationTargetOptions(automation: Automation, patch: AutomationPatch) {
  return {
    target: patch.target === null ? undefined : (patch.target ?? automation.target),
    vendor: patch.vendor === null ? undefined : (patch.vendor ?? automation.vendor),
    model: patch.model === null ? undefined : (patch.model ?? automation.model),
    modelEffort: patch.modelEffort === null ? undefined : (patch.modelEffort ?? automation.modelEffort),
    baseRef: patch.baseRef === null ? undefined : (patch.baseRef ?? automation.baseRef),
    persistentSession: patch.persistentSession ?? automation.persistentSession,
    sessionTaskId:
      patch.target || patch.sessionTaskId === null ? undefined : (patch.sessionTaskId ?? automation.sessionTaskId),
  }
}

export async function assertAutomationTargetTask(
  value: Pick<Automation, "repo" | "target">,
  orch: Pick<DaemonOrchestrator, "getTask">,
): Promise<void> {
  if (!value.target) return
  const task = orch.getTask(value.target.taskId)
  if (!task || task.deletion || !task.worktreePath) throw new Error(`target task unavailable: ${value.target.taskId}`)
  const [repo, taskRepo] = await Promise.all([realpath(value.repo), realpath(task.repo)])
  if (repo !== taskRepo) throw new Error(`routine repo must match target task repo: ${task.repo}`)
}
