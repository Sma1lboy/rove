/** Automation/routine RPC helpers for {@link RemoteOrchestrator}, split out of `remote-orchestrator-writes.ts`. */

import type { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import type { Automation, AutomationRun, AutomationRunStatus } from "@sma1lboy/rove-daemon/daemon/contracts"

/** Scheduled and event-driven routines. `lastRunStatus` = latest run's status per id; `lastFailure` = newest recent failure. */
export async function listAutomationsOp(client: RoveDaemonClient): Promise<{
  automations: Automation[]
  keepsDaemonAlive: boolean
  lastRunStatus?: Record<string, AutomationRunStatus>
  lastFailure?: Record<string, { readonly at: string; readonly reason: string }>
}> {
  return client.request("automation.list", {})
}

/** Create a scheduled and/or event-driven routine (`automation.create`); no `repo` = a projectless routine. */
export async function createAutomationOp(
  client: RoveDaemonClient,
  input: {
    repo?: string
    name: string
    prompt: string
    schedule?: string
    eventTriggers?: Automation["eventTriggers"]
    webhook?: boolean
    target?: Automation["target"]
  },
): Promise<{ automation: Automation }> {
  return client.request("automation.create", input)
}

/** One automation's run history (`automation.runs`), newest first. */
export async function automationRunsOp(client: RoveDaemonClient, id: string): Promise<{ runs: AutomationRun[] }> {
  return client.request("automation.runs", { id })
}

/** Pause / resume (`automation.update` with just `enabled`). */
export async function setAutomationEnabledOp(
  client: RoveDaemonClient,
  id: string,
  enabled: boolean,
): Promise<{ automation: Automation }> {
  return client.request("automation.update", { id, enabled })
}

/** Fire one now, skipping its precheck (`automation.runNow`). */
export async function runAutomationNowOp(client: RoveDaemonClient, id: string): Promise<{ status: string }> {
  return client.request("automation.runNow", { id })
}

/** Delete an automation and its history (`automation.delete`). */
export async function deleteAutomationOp(client: RoveDaemonClient, id: string): Promise<{ deleted: boolean }> {
  return client.request("automation.delete", { id })
}
