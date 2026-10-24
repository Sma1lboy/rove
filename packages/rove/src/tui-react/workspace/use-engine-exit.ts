/**
 * The active tab's "engine exited" strip, from the daemon's row status
 * (`row-status-sync.ts`). A Retry hides the strip until the daemon records a
 * newer status for the tab, so the death it already answered can't re-draw it.
 */

import { useEffect, useState } from "react"
import type { SectionId } from "../../tui/component/settings-dialog/model"
import { engineExitOf } from "../../tui/workspace/engine-exit"
import { getDefaultLiveEngines } from "../../tui/workspace/live-engine"
import { type TerminalTab, tabPtyKeyFor } from "../../tui/workspace/terminal-tabs-core"
import type { HookTabState } from "../../tui/workspace/turn-state-merge"
import type { EngineExit } from "../panes/terminal/engine-exit-banner"
import { useTabRowStatus } from "./row-status-sync"

export function useEngineExit(io: {
  readonly taskId: string
  readonly tab: TerminalTab
  readonly hook: HookTabState | undefined
  readonly retry: () => void
  readonly anotherEngine: () => void
  readonly onOpenSettings?: (section: SectionId) => void
}): EngineExit | undefined {
  const status = useTabRowStatus(io.taskId, io.tab.id)
  const [retried, setRetried] = useState<{ readonly tabId: string; readonly since: number } | null>(null)
  const [, redraw] = useState(0)
  useEffect(() => getDefaultLiveEngines().subscribe(() => redraw((n) => n + 1)), [])
  const key = tabPtyKeyFor(io.taskId, io.tab)
  const view = engineExitOf(
    io.tab,
    status,
    io.hook,
    retried?.tabId === io.tab.id ? retried.since : undefined,
    !!getDefaultLiveEngines().resolve(key),
  )
  if (!view) return undefined
  return {
    code: view.code,
    onRetry: () => {
      // The strip can outlive the death it names (a stale status): an engine seen running wins.
      if (getDefaultLiveEngines().resolve(key)) {
        redraw((n) => n + 1)
        return
      }
      if (status) setRetried({ tabId: io.tab.id, since: status.since })
      io.retry()
    },
    onSettings: io.onOpenSettings ? () => io.onOpenSettings?.("engines") : undefined,
    onAnotherEngine: io.anotherEngine,
  }
}
