/**
 * Poll the pty host's session inventory for the orphan-tab backstop
 * (`orphan-tabs.ts`). A POLL, not a subscription: the host publishes
 * `pty.data` only to ATTACHED connections, and these are the sessions this
 * TUI never attached. `pty.list` is a cheap in-memory read.
 *
 * Every failure resolves to "no orphans": the backstop only ADDS rows, so
 * being wrong costs a missing row, never a phantom one.
 */

import { useEffect, useState } from "react"
import { getSharedPtyClient } from "../../../tui/panes/terminal/pty-hosted-client"
import type { LiveSession } from "./orphan-tabs"

/** The live-engine probe's cadence; sessions start on human time. */
const POLL_MS = 2_000

const EMPTY: readonly LiveSession[] = []

/**
 * Same sessions in the same state, over the fields the tree reads: a change
 * rebuilds the whole tree, so a quiet host must stay render-free. Exported
 * for tests: the poll is off under every runner ({@link pollingAllowed}).
 */
export function sameSessions(a: readonly LiveSession[], b: readonly LiveSession[]): boolean {
  if (a.length !== b.length) return false
  return a.every((s, i) => {
    const other = b[i]
    return (
      other !== undefined &&
      s.key === other.key &&
      s.alive === other.alive &&
      s.title === other.title &&
      s.pid === other.pid &&
      s.restored === other.restored
    )
  })
}

/**
 * Off under a test runner. `getSharedPtyClient` caches ONE connection per
 * process and bun-test runs every render file in one process, so a mounted
 * sidebar would pin a stale client and `pty-hosted.test.ts` (which points
 * `KOBE_PTY_SOCKET_PATH` at its own fixture) would time out.
 */
function pollingAllowed(): boolean {
  return process.env.NODE_ENV !== "test" && process.env.BUN_TEST !== "1" && process.env.VITEST !== "true"
}

export function useHostSessions(enabled = pollingAllowed()): readonly LiveSession[] {
  const [sessions, setSessions] = useState<readonly LiveSession[]>(EMPTY)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const poll = async (): Promise<void> => {
      try {
        const client = await getSharedPtyClient()
        const { sessions: live = [] } = await client.request<{ sessions?: LiveSession[] }>("pty.list", {})
        if (!cancelled) setSessions((prev) => (sameSessions(prev, live) ? prev : live))
      } catch {
        // No host / no verb / socket died: no orphans; retry next tick.
        if (!cancelled) setSessions((prev) => (prev.length === 0 ? prev : EMPTY))
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [enabled])

  return sessions
}
