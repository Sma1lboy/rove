/** The built-in plugins' pages, registered through the same factory contract as installed ones. */

import { BUNDLED_PLUGINS, isBundledPluginEnabled } from "../../bundled-plugins"
import { pageHost } from "./host-api"
import { setPageSource } from "./registry"

/** Register every enabled built-in plugin's pages; a disabled plugin's leave the rail. */
export function registerBundledPlugins(enabled: (id: string) => boolean = isBundledPluginEnabled): void {
  for (const plugin of BUNDLED_PLUGINS) {
    setPageSource(
      `bundled:${plugin.id}`,
      enabled(plugin.id)
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
