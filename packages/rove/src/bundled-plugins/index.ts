/**
 * The first-party mods compiled into Rove. None is on until installed (`rove
 * plugin install <id>` or Settings → Plugins), which writes the daemon-side
 * `builtin-mods.json` every surface reads, so the TUI, the web and `rove api`
 * agree on what is present.
 */

import {
  type BuiltinModId,
  isBuiltinModInstalled,
  setBuiltinModInstalled,
} from "@sma1lboy/rove-daemon/plugins/builtin-mods"
import { issuesPlugin } from "./issues/plugin"
import { kanbanPlugin } from "./kanban/plugin"
import type { BundledPlugin } from "./types"

export const BUNDLED_PLUGINS: readonly BundledPlugin[] = [kanbanPlugin, issuesPlugin]

export function isBundledPluginInstalled(id: BuiltinModId): boolean {
  return isBuiltinModInstalled(id)
}

export function setBundledPluginInstalled(id: BuiltinModId, installed: boolean): void {
  setBuiltinModInstalled(id, installed)
}
