/** `rove plugin` for first-party mods: install/uninstall only flip `builtin-mods.json`; nothing is cloned or run. */

import {
  BUILTIN_MODS,
  type BuiltinModId,
  installedBuiltinMods,
  setBuiltinModInstalled,
} from "@sma1lboy/rove-daemon/plugins/builtin-mods"

export function builtinModRows(homeDir?: string): string[] {
  const installed = new Set(installedBuiltinMods(homeDir))
  return BUILTIN_MODS.map(
    (mod) => `${mod.id}  first-party  ${installed.has(mod.id) ? "installed" : "not installed"}  (${mod.description})`,
  )
}

export function setBuiltinMod(id: BuiltinModId, install: boolean, homeDir?: string): string {
  const was = installedBuiltinMods(homeDir).includes(id)
  setBuiltinModInstalled(id, install, homeDir)
  if (install) return was ? `${id} is already installed` : `installed ${id}`
  return was ? `uninstalled ${id} (its data stays on disk; reinstall picks it up)` : `${id} is not installed`
}
