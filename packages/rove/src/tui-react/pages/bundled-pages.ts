/** The first-party mods' pages, registered through the same factory contract as installed ones. */

import { unwatchFile, watchFile } from "node:fs"
import type { BuiltinModId } from "@sma1lboy/rove-daemon/plugins/builtin-mods"
import { builtinModsPath } from "@sma1lboy/rove-daemon/plugins/plugin-paths"
import { BUNDLED_PLUGINS, isBundledPluginInstalled } from "../../bundled-plugins"
import { pageHost } from "./host-api"
import { setPageSource } from "./registry"

/** Register every installed first-party mod's pages; an uninstalled one's leave the rail. */
export function registerBundledPlugins(installed: (id: BuiltinModId) => boolean = isBundledPluginInstalled): void {
  for (const plugin of BUNDLED_PLUGINS) {
    setPageSource(
      `bundled:${plugin.id}`,
      installed(plugin.id)
        ? plugin.pages.map((page) => ({
            id: `${plugin.id}.${page.id}`,
            title: () => page.title(pageHost),
            order: page.order,
            ...(page.action ? { action: page.action } : {}),
            component: page.factory(pageHost),
            pluginId: plugin.id,
          }))
        : [],
    )
  }
}

/** An install from the web or the CLI reaches this TUI's rail without a restart. Returns the stop. */
export function followBundledPlugins(): () => void {
  const path = builtinModsPath()
  const reload = () => registerBundledPlugins()
  watchFile(path, { interval: 2000, persistent: false }, reload)
  return () => unwatchFile(path, reload)
}
