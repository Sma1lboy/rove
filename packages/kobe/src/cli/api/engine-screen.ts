/**
 * A task's engine terminal, read without spawning: the raw `pty.peek` that
 * `read-output` pages through, and the failure row an engine drew on screen
 * but never reported through a hook (`EngineRegistryEntry.errorLine`).
 */

import type { PtyPeekResult, SerializedTask } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { protocolEntry } from "../../engine/engine-presets.ts"
import { screenErrorLine } from "../../engine/screen-state.ts"
import type { VendorId } from "../../types/vendor.ts"
import { findEngineKey, listSessionsOrNull, openPtyHost } from "./pty-delivery.ts"
import { type TerminalPeekPage, boundedTail } from "./read-output-page.ts"
import { taskEngineArgv } from "./tab-snapshot.ts"
import { ApiError } from "./types.ts"

/** Read-only `pty.peek`; never spawns. A failed host connect/list/peek RPC is
 *  "host-unreachable"; any other non-ApiError failure reads as null.
 *
 *  An explicit unknown `tab` is TAB_NOT_FOUND, not empty. Without one:
 *  findEngineKey matches only ALIVE sessions, so fall back to `tab-1` (the
 *  engine tab the TUI mints first) to read a dead engine's scrollback. */
export async function peekTaskTerminal(
  taskId: string,
  engineBin: string | undefined,
  tab: string | undefined,
  sinceOffset?: number,
): Promise<TerminalPeekPage | null | "host-unreachable"> {
  const host = await openPtyHost()
  if (!host) return "host-unreachable"
  try {
    let key: string | undefined
    if (tab) {
      key = `${taskId}::${tab}`
    } else {
      // Tri-state: an unaskable host is not "no sessions".
      const sessions = await listSessionsOrNull(host.rpc)
      if (sessions === null) return "host-unreachable"
      key = findEngineKey(sessions, taskId, engineBin) ?? sessions.find((s) => s.key === `${taskId}::tab-1`)?.key
    }
    if (!key) return null
    // With --tab this is the first RPC; its failure means unreachable, not empty.
    let res: PtyPeekResult
    try {
      res = await host.rpc.request<PtyPeekResult>("pty.peek", { key, sinceOffset })
    } catch {
      return "host-unreachable"
    }
    if (!res.exists) {
      if (tab) {
        throw new ApiError(
          `tab ${tab} has no hosted session on task ${taskId} — see \`rove api pty-list\` for live tabs`,
          "TAB_NOT_FOUND",
        )
      }
      return null
    }
    return {
      pid: res.pid,
      offset: res.offset,
      text: Buffer.from(res.data, "base64").toString("utf8"),
      sinceValid: res.sinceValid,
      live: res.alive,
      exit: res.exit ?? null,
    }
  } catch (err) {
    if (err instanceof ApiError) throw err
    return null
  } finally {
    host.close()
  }
}

/**
 * The engine-declared error row at the bottom of a task's engine tab, or
 * undefined: no rule for this engine, no session, host unreachable, or no
 * error on screen. Never throws — it only ever adds evidence.
 */
export async function engineScreenError(
  task: SerializedTask,
  opts: { readonly last?: boolean } = {},
): Promise<string | undefined> {
  const pattern = protocolEntry(task.vendor as VendorId | undefined).errorLine
  if (!pattern) return undefined
  try {
    const page = await peekTaskTerminal(task.id, taskEngineArgv(task)[0], undefined)
    if (!page || page === "host-unreachable") return undefined
    return screenErrorLine(pattern, boundedTail(page.text).tail, opts)
  } catch {
    return undefined
  }
}
