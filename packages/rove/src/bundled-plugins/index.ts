/**
 * The built-in plugins and their on/off switch. Enabled unless the user turned
 * one off in Settings → Plugins (`state.json` `plugins.bundled.<id>.enabled`).
 */

import { getPersistedBool, setPersistedBool } from "../state/store"
import { issuesPlugin } from "./issues/plugin"
import { kanbanPlugin } from "./kanban/plugin"
import type { BundledPlugin } from "./types"

export const BUNDLED_PLUGINS: readonly BundledPlugin[] = [kanbanPlugin, issuesPlugin]

const enabledKey = (id: string) => `plugins.bundled.${id}.enabled`

export function isBundledPluginEnabled(id: string): boolean {
  return getPersistedBool(enabledKey(id), true)
}

export function setBundledPluginEnabled(id: string, enabled: boolean): void {
  setPersistedBool(enabledKey(id), enabled)
}
