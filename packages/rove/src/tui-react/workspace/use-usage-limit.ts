/**
 * The active tab's "usage limit" strip, from the daemon's row status
 * (`row-status-sync.ts`): the engine's activity is `rate_limited`. The strip is
 * driven by that engine-owned state alone and disappears when the state leaves
 * it. A dismiss hides it for that limit episode (`status.since`); the next
 * limit draws it again.
 */

import { useState } from "react"
import type { TerminalTab } from "../../tui/workspace/terminal-tabs-core"
import type { UsageLimit } from "../panes/terminal/engine-exit-banner"
import { useTabRowStatus } from "./row-status-sync"
import type { NewChatPreset } from "./use-tab-dialogs"

export function useUsageLimit(io: {
  readonly taskId: string
  readonly tab: TerminalTab
  /** The dead-engine strip owns the pane while it shows. */
  readonly suppressed: boolean
  readonly requestNewChat: (preset?: NewChatPreset) => void
}): UsageLimit | undefined {
  const status = useTabRowStatus(io.taskId, io.tab.id)
  const [dismissed, setDismissed] = useState<{ readonly tabId: string; readonly since: number } | null>(null)
  if (io.tab.kind !== "engine" || io.suppressed || status?.reason !== "rate_limited") return undefined
  if (dismissed?.tabId === io.tab.id && dismissed.since === status.since) return undefined
  return {
    onContinueInEngine: () => io.requestNewChat({ context: "continue" }),
    onDismiss: () => setDismissed({ tabId: io.tab.id, since: status.since }),
  }
}
