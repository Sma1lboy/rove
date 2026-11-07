/**
 * The strips over the active tab's terminal: "engine exited" (the daemon marked the engine dead) and
 * "usage limit" (its activity is `rate_limited`). The dead strip outranks the limit.
 */

import type { SectionId } from "../../tui/component/settings-dialog/model"
import type { TerminalTab } from "../../tui/workspace/terminal-tabs-core"
import type { HookTabState } from "../../tui/workspace/turn-state-merge"
import type { EngineExit, UsageLimit } from "../panes/terminal/engine-exit-banner"
import { useEngineExit } from "./use-engine-exit"
import type { NewChatPreset } from "./use-tab-dialogs"
import { useUsageLimit } from "./use-usage-limit"

export function useTabNotices(io: {
  readonly taskId: string
  readonly tab: TerminalTab
  readonly hook: HookTabState | undefined
  readonly retry: () => void
  readonly requestNewChat: (preset?: NewChatPreset) => void
  readonly onOpenSettings?: (section: SectionId) => void
}): { readonly engineExit: EngineExit | undefined; readonly usageLimit: UsageLimit | undefined } {
  const engineExit = useEngineExit(io)
  const usageLimit = useUsageLimit({ ...io, suppressed: engineExit !== undefined })
  return { engineExit, usageLimit }
}
