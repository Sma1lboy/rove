/**
 * `send --tab tab-N`: delivery into ONE addressed terminal tab. Never
 * searches and never spawns a second engine (that's the canonical path in
 * `pty-delivery.ts`); the only questions are whether the tab can take a
 * prompt and, if a pty-host restart froze it, whether the caller asked to
 * revive it.
 */

import type { PtyOpenResult } from "@sma1lboy/kobe-daemon/daemon/protocol"
import type { PtySessionInfo } from "@sma1lboy/kobe-daemon/daemon/pty-host"
import type { PsSnapshot } from "../../engine/foreground.ts"
import { awaitEngineProcess, hostedSessionFailureLine } from "../../engine/hosted-session.ts"
import { enginePresence } from "../../engine/session-engine-presence.ts"
import type { EngineSessionLaunch } from "../../engine/session-launch.ts"
import { readPersistedTerminalDefaultColors } from "../../tui/lib/terminal-colors.ts"
import type { VendorId } from "../../types/vendor.ts"
import {
  ENGINE_NOT_OBSERVED_REASON,
  ENGINE_START_POLL_MS,
  ENGINE_START_PROBE_MS,
  type PtyHostRpc,
  deliverToKey,
  outcomeFields,
} from "./pty-delivery.ts"
import { ApiError, type DeliveredPrompt } from "./types.ts"

/**
 * Deliver into ONE exact tab (`send --tab tab-N`) — no fallback, no search.
 * The addressed tab must be able to take the prompt; anything else is a typed
 * error so a script targeting "the second tab" never silently lands in the
 * first. The one tab this may START is the addressed one itself, and only
 * when it is freeze-restored AND the caller passed `opts.respawn`.
 */
export async function deliverToExactTab(
  rpc: PtyHostRpc,
  taskId: string,
  tabId: string,
  cwd: string,
  prompt: string,
  opts?: {
    readonly engineBin?: string
    readonly snapshot?: PsSnapshot
    /** Caller consent to revive a freeze-restored tab (`send --respawn`),
     *  plus the resume launch to bring it back with. `null` from the factory
     *  = the snapshot has no engine tab by this id, so the host replays the
     *  frozen command instead. */
    readonly respawn?: () => EngineSessionLaunch | null
  },
): Promise<DeliveredPrompt> {
  const key = `${taskId}::${tabId}`
  const { sessions = [] } = await rpc.request<{ sessions?: PtySessionInfo[] }>("pty.list", {})
  const session = sessions.find((s) => s.key === key)
  if (!session?.alive) {
    // A FREEZE-RESTORED tab is not an absent one: the host lists it and
    // `pty.open` respawns it in place, so it must not read as TAB_NOT_FOUND.
    if (session?.restored === true) {
      if (!opts?.respawn) throw restoredTabError(taskId, tabId, prompt)
      const launch = opts.respawn()
      // A size-less open: the host keeps the frozen geometry, and the
      // caller's command (when it has one) wins over the frozen launch.
      const open = await rpc.request<PtyOpenResult>("pty.open", {
        key,
        cwd,
        ...(launch ? { command: launch.command } : {}),
        defaultColors: readPersistedTerminalDefaultColors(),
      })
      if (open.respawned !== true && open.alive !== true) {
        throw new ApiError(`tab ${tabId} on task ${taskId} could not be respawned`, "SESSION_FAILED", {
          taskId,
          tabId,
          hint: "the frozen record is still on disk; open the task in the TUI to see the session's own output",
          nextCommandArgs: ["api", "read-output", "--task-id", taskId, "--tab", tabId, "--source", "terminal"],
        })
      }
      // PASTED, never woven into the respawn argv (a resumed engine must not
      // replay the first prompt), so the engine has to be up before the write.
      const enginePid = await awaitEngineProcess(rpc, key, opts.engineBin, {
        timeoutMs: ENGINE_START_PROBE_MS,
        intervalMs: ENGINE_START_POLL_MS,
        snapshot: opts.snapshot,
      })
      if (enginePid === null) {
        return {
          session: key,
          pane: key,
          started: false,
          respawned: true,
          engineReady: false,
          delivered: false,
          reason: (await hostedSessionFailureLine(rpc, key)) ?? ENGINE_NOT_OBSERVED_REASON,
        }
      }
      return await deliverRespawned(rpc, key, prompt, enginePid.vendor)
    }
    throw new ApiError(
      `tab ${tabId} has no live session on task ${taskId} — see \`rove api pty-list\` for alive tabs`,
      "TAB_NOT_FOUND",
    )
  }
  // Never paste into a shell. ANY running engine passes — it need not match
  // the task's vendor (cross-vendor send).
  const presence = await enginePresence(session.pid, opts?.engineBin, opts?.snapshot)
  if (presence.kind === "unknown") {
    // Refuse, but do not claim the tab is a shell — we never got to look.
    throw new ApiError(
      `could not read the process table, so tab ${tabId} on task ${taskId} could not be checked for a live engine`,
      "ENGINE_PROBE_FAILED",
      {
        hint: "the `ps` probe failed or timed out; retry, or check the machine's process table",
        nextCommandArgs: ["api", "pty-list"],
      },
    )
  }
  if (presence.kind !== "engine") {
    throw new ApiError(
      `tab ${tabId} on task ${taskId} has no live engine process — it is a plain shell right now`,
      "ENGINE_NOT_RUNNING",
      {
        hint: "spawn a fresh engine tab for this prompt with --tab new, or pick an engine tab from pty-list",
        nextCommandArgs: ["api", "pty-list"],
      },
    )
  }
  // No pty.detach — see deliverHostedPrompt's existing-key path.
  const outcome = await deliverToKey(rpc, key, prompt, { vendor: presence.vendor })
  return { session: key, pane: key, started: false, ...outcomeFields(outcome) }
}

/**
 * Write into a tab this call just respawned. `respawned: true` lets the caller
 * tell "reopened your frozen conversation" from "delivered into a session
 * already running".
 */
async function deliverRespawned(
  rpc: PtyHostRpc,
  key: string,
  prompt: string,
  vendor: VendorId | null,
): Promise<DeliveredPrompt> {
  const outcome = await deliverToKey(rpc, key, prompt, { vendor })
  return { session: key, pane: key, started: false, respawned: true, ...outcomeFields(outcome) }
}

/**
 * The refusal a restored tab gets without `--respawn` — opt-in because
 * reviving a tab with no pinned conversation id replays the task's original
 * first prompt.
 */
function restoredTabError(taskId: string, tabId: string, prompt: string): ApiError {
  return new ApiError(
    `tab ${tabId} on task ${taskId} is a freeze-restored session — its pty host restarted, so the tab exists with its scrollback but nothing is running in it`,
    "TAB_RESTORED",
    {
      taskId,
      tabId,
      hint: "revive it with --respawn (resumes the tab's pinned conversation when it has one — `get-task` shows `sessionId`; a tab without one replays its recorded launch command)",
      nextCommandArgs: ["api", "send", "--task-id", taskId, "--tab", tabId, "--respawn", "--prompt", prompt],
    },
  )
}
