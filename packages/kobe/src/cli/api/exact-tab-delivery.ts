/**
 * `send --tab tab-N`: delivery into ONE addressed terminal tab.
 *
 * Split from `pty-delivery.ts`, which owns the CANONICAL path — find the
 * task's engine session, or create it when the task has none. This side
 * never searches and never spawns a second engine: the caller named a tab,
 * so the only questions are whether that tab can take a prompt and, when a
 * pty-host restart froze it, whether the caller asked for it to be revived.
 *
 * Shared reporting helpers (`outcomeFields`, the engine-start probe budget,
 * the composer-busy deferral) stay in `pty-delivery.ts` and are imported
 * here, so both paths keep spelling an outcome the same way.
 */

import type { PtyOpenResult } from "@sma1lboy/kobe-daemon/daemon/protocol"
import type { PtySessionInfo } from "@sma1lboy/kobe-daemon/daemon/pty-host"
import type { PsSnapshot } from "../../engine/foreground.ts"
import {
  ComposerBusyError,
  type PromptWriteOutcome,
  awaitEngineProcess,
  hostedSessionFailureLine,
} from "../../engine/hosted-session.ts"
import { sessionHasEngine } from "../../engine/session-engine-presence.ts"
import type { EngineSessionLaunch } from "../../engine/session-launch.ts"
import { readPersistedTerminalDefaultColors } from "../../tui/lib/terminal-colors.ts"
import type { VendorId } from "../../types/vendor.ts"
import {
  ENGINE_NOT_OBSERVED_REASON,
  ENGINE_START_POLL_MS,
  ENGINE_START_PROBE_MS,
  type PtyHostRpc,
  deferOrThrow,
  deliverToKey,
  outcomeFields,
  resolveComposerManifest,
} from "./pty-delivery.ts"
import { ApiError, type DeliveredPrompt, type PromptDeferralSink } from "./types.ts"

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
    readonly vendor?: VendorId
    readonly defer?: PromptDeferralSink
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
    // A FREEZE-RESTORED tab is not an absent one: the host is listing it, its
    // command/cwd/scrollback survived, and `pty.open` respawns it in place.
    // Saying TAB_NOT_FOUND here sent the caller to `pty-list`, which lists
    // the very tab it just refused — and left every task's real conversation
    // headlessly unreachable after a reboot.
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
          hint: "the frozen record is still on disk; open the task in the TUI to see the session's own output",
          nextCommandArgs: ["api", "read-output", "--task-id", taskId, "--tab", tabId, "--source", "terminal"],
        })
      }
      // The prompt is PASTED, never woven into the respawn argv — an engine
      // resumed by id must not replay the task's first prompt. So the engine
      // has to be up before the write; `engineReady: false` below is the
      // honest answer when it never appeared.
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
      return await deliverRespawned(rpc, key, prompt, opts, taskId, tabId)
    }
    throw new ApiError(
      `tab ${tabId} has no live session on task ${taskId} — see \`rove api pty-list\` for alive tabs`,
      "TAB_NOT_FOUND",
    )
  }
  // Same foreground gate as the canonical path: an addressed tab whose
  // engine exited (or that always was a shell tab) must not have the prompt
  // pasted into its shell. ANY running engine passes — the addressed tab's
  // engine need not match the task's vendor (cross-vendor send).
  if (!(await sessionHasEngine(session.pid, opts?.engineBin, opts?.snapshot))) {
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
  const deliveryOpts = { screenManifest: resolveComposerManifest(opts?.vendor) }
  let outcome: PromptWriteOutcome | null
  try {
    outcome = await deliverToKey(rpc, key, prompt, deliveryOpts)
  } catch (err) {
    if (err instanceof ComposerBusyError) return deferOrThrow(err, opts?.defer, taskId, tabId, prompt)
    throw err
  }
  return { session: key, pane: key, started: false, ...outcomeFields(outcome) }
}

/**
 * Write into a tab this call just respawned. Same gate/deferral contract as
 * the alive path, with `respawned: true` so the caller can tell "reopened
 * your frozen conversation" from "delivered into a session already running".
 */
async function deliverRespawned(
  rpc: PtyHostRpc,
  key: string,
  prompt: string,
  opts: { readonly vendor?: VendorId; readonly defer?: PromptDeferralSink },
  taskId: string,
  tabId: string,
): Promise<DeliveredPrompt> {
  let outcome: PromptWriteOutcome | null
  try {
    outcome = await deliverToKey(rpc, key, prompt, { screenManifest: resolveComposerManifest(opts.vendor) })
  } catch (err) {
    if (err instanceof ComposerBusyError) return deferOrThrow(err, opts.defer, taskId, tabId, prompt)
    throw err
  }
  return { session: key, pane: key, started: false, respawned: true, ...outcomeFields(outcome) }
}

/**
 * The refusal a restored tab gets without `--respawn`. Distinct code, and it
 * names the missing STEP rather than pointing back at the listing that shows
 * the tab: reviving re-runs the tab's recorded launch, which for a tab with
 * no pinned conversation id replays the task's original first prompt.
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
