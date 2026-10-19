/**
 * Load installed plugins' `[[pages]]` into the page registry. A page module
 * runs in the TUI process with the trust its plugin's commands already have.
 *
 * React must be ONE instance: a page's own `react` / `@opentui/react` /
 * `@opentui/core` imports are rewritten to the host's by OpenTUI's Bun runtime
 * plugin, installed before the first page import. Best-effort per page: a
 * broken one contributes nothing and its error is shown in Settings → Plugins.
 * A module is imported once per process; new code needs a restart.
 */

import { existsSync } from "node:fs"
import { resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { readPluginManifest } from "@sma1lboy/rove-daemon/plugins/manifest"
import { loadPluginRegistry } from "@sma1lboy/rove-daemon/plugins/registry"
import { errorMessage } from "../../lib/error-message"
import { isPageAction } from "../../tui/panes/sidebar/nav-core"
import { pageHost } from "./host-api"
import { type PluginPageError, pluginPageErrorState } from "./page-errors"
import { type PageComponent, type PageEntry, replacePageSources } from "./registry"

export { pluginPageErrors } from "./page-errors"

let runtimeReady = false

async function ensureSharedRuntime(): Promise<void> {
  if (runtimeReady) return
  const { ensureRuntimePluginSupport } = await import("@opentui/react/runtime-plugin-support/configure")
  ensureRuntimePluginSupport()
  runtimeReady = true
}

/** A page module's default export: `(host) => Component` or `(host) => ({ component })`. */
async function importPage(root: string, entry: string): Promise<PageComponent> {
  const path = resolve(root, entry)
  if (!path.startsWith(`${resolve(root)}${sep}`)) throw new Error(`entry \`${entry}\` is outside the plugin`)
  if (!existsSync(path)) throw new Error(`entry \`${entry}\` does not exist`)
  await ensureSharedRuntime()
  const mod = (await import(pathToFileURL(path).href)) as { default?: unknown }
  if (typeof mod.default !== "function") throw new Error("default export must be a page factory: (host) => Page")
  const made: unknown = mod.default(pageHost)
  const component = typeof made === "function" ? made : (made as { component?: unknown } | null)?.component
  if (typeof component !== "function") throw new Error("the page factory returned no component")
  return component as PageComponent
}

/**
 * (Re)load every enabled plugin's pages; replaces all `plugin:` sources at once.
 * Never rejects: each failure is caught where it happens and shown in Settings → Plugins.
 */
export async function loadPluginPages(homeDir?: string): Promise<void> {
  const byPlugin = new Map<string, PageEntry[]>()
  const failed: PluginPageError[] = []
  let entries: ReturnType<typeof loadPluginRegistry>["plugins"] = []
  try {
    entries = loadPluginRegistry(homeDir).plugins
  } catch {
    /* unreadable registry → no plugin pages */
  }
  for (const entry of entries) {
    if (!entry.enabled) continue
    let pages: ReturnType<typeof readPluginManifest>["manifest"]["pages"]
    try {
      pages = readPluginManifest(entry.root).manifest.pages
    } catch {
      continue
    }
    const loaded: PageEntry[] = []
    for (const page of pages) {
      try {
        const component = await importPage(entry.root, page.entry)
        if (page.action !== undefined && !isPageAction(page.action)) {
          failed.push({
            pluginId: entry.id,
            pageId: page.id,
            message: `action \`${page.action}\` is not a page-open action; opens from the rail only`,
          })
        }
        const action = page.action !== undefined && isPageAction(page.action) ? page.action : undefined
        loaded.push({
          id: `${entry.id}.${page.id}`,
          title: () => page.title,
          order: page.order,
          ...(action ? { action } : {}),
          component,
          pluginId: entry.id,
        })
      } catch (err) {
        failed.push({ pluginId: entry.id, pageId: page.id, message: errorMessage(err) })
      }
    }
    byPlugin.set(entry.id, loaded)
  }
  replacePageSources("plugin:", byPlugin)
  pluginPageErrorState.set(failed)
}
