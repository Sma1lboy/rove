/**
 * Framework-free view model for Settings → Marketplace: joins the GitHub
 * topic listing (`cli/plugin-search`) with the local registry so a row can
 * say "already installed" instead of offering a second copy. Pure — the
 * React section maps these rows to boxes, and `use-section-data` owns the
 * fetch and the install flow.
 */

import type { MarketEntry } from "../../../cli/plugin-search"
import type { PluginRowView } from "./plugins-core"

export interface MarketplaceRowView {
  /** `owner/repo[/subdir]` — exactly what `plugin install` takes. */
  readonly ref: string
  readonly desc: string
  /** GitHub stars, or null for a first-party seed served without a query. */
  readonly stars: number | null
  readonly firstParty: boolean
  /** Registry id this ref is already installed as, or null. */
  readonly installedId: string | null
}

/**
 * Installed GitHub specs → their registry id. Linked plugins are excluded:
 * their `source` is a local path, never a marketplace ref, so matching one
 * against this map would be comparing a directory to `owner/repo`.
 */
export function installedSpecIds(plugins: readonly PluginRowView[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const plugin of plugins) {
    if (plugin.linked) continue
    map.set(plugin.source.toLowerCase(), plugin.id)
  }
  return map
}

/** One row per listing entry, in listing order. */
export function marketplaceRowViews(
  entries: readonly MarketEntry[],
  plugins: readonly PluginRowView[],
): MarketplaceRowView[] {
  const installed = installedSpecIds(plugins)
  return entries.map((entry) => ({
    ref: entry.ref,
    desc: entry.desc,
    stars: entry.stars ?? null,
    firstParty: entry.firstParty === true,
    installedId: installed.get(entry.ref.toLowerCase()) ?? null,
  }))
}
