/**
 * `<home>/.kobe/plugins.json` — the installed/linked plugin registry.
 *
 * Written by the `kobe plugin` CLI; read (and stat-polled) by the daemon's
 * plugin runtime. Registration is global to the user, like herdr's: one list
 * for every session. The file is small and rewritten whole on every mutation.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { OWNER_ONLY_FILE_MODE } from "../daemon/owner-only.ts"
import { legacyPluginsRootDir, pluginRegistryPath, pluginsRootDir } from "./plugin-paths.ts"

export interface PluginRegistryEntry {
  readonly id: string
  /** `github` = managed checkout under plugins/<id>/checkout; `link` = author's working dir. */
  readonly source: { readonly kind: "github"; readonly spec: string } | { readonly kind: "link" }
  /** Absolute plugin root (containing rove-plugin.toml or its legacy alias). */
  readonly root: string
  readonly enabled: boolean
  readonly version: string
  readonly installedAt: number
}

export interface PluginRegistry {
  readonly plugins: readonly PluginRegistryEntry[]
}

const EMPTY: PluginRegistry = { plugins: [] }

export function loadPluginRegistry(homeDir?: string): PluginRegistry {
  let text: string
  try {
    text = readFileSync(pluginRegistryPath(homeDir), "utf8")
  } catch {
    return EMPTY
  }
  try {
    const raw = JSON.parse(text) as { plugins?: unknown }
    if (!Array.isArray(raw.plugins)) return EMPTY
    return { plugins: raw.plugins.filter(isEntry).map((entry) => withCanonicalRoot(entry, homeDir)) }
  } catch {
    // A corrupt registry disables plugins rather than crashing the daemon;
    // the next CLI mutation rewrites it whole.
    return EMPTY
  }
}

/**
 * A managed checkout's `root` is an absolute path recorded at install time.
 * The `.kobe` → `.rove` layout migration moves the checkout tree but the
 * registry still names the old tree, so every manifest read fails with
 * "no rove-plugin.toml found at ~/.kobe/plugins/…". Re-anchor a root that
 * sits under the legacy plugins dir onto the canonical one; the next save
 * writes the corrected path. Linked plugins keep the author's root as-is.
 */
function withCanonicalRoot(entry: PluginRegistryEntry, homeDir?: string): PluginRegistryEntry {
  if (entry.source.kind !== "github") return entry
  const legacy = legacyPluginsRootDir(homeDir)
  const canonical = pluginsRootDir(homeDir)
  if (legacy === canonical) return entry
  const inside = relative(legacy, entry.root)
  if (inside === "" || inside.startsWith("..") || inside.startsWith("/")) return entry
  return { ...entry, root: join(canonical, inside) }
}

function isEntry(v: unknown): v is PluginRegistryEntry {
  if (typeof v !== "object" || v === null) return false
  const e = v as Record<string, unknown>
  const source = e.source as Record<string, unknown> | undefined
  return (
    typeof e.id === "string" &&
    typeof e.root === "string" &&
    typeof e.enabled === "boolean" &&
    typeof e.version === "string" &&
    typeof e.installedAt === "number" &&
    typeof source === "object" &&
    source !== null &&
    (source.kind === "link" || (source.kind === "github" && typeof source.spec === "string"))
  )
}

export function savePluginRegistry(registry: PluginRegistry, homeDir?: string): void {
  const path = pluginRegistryPath(homeDir)
  mkdirSync(dirname(path), { recursive: true })
  // 0600: the registry names every installed plugin and its checkout path.
  writeFileSync(path, `${JSON.stringify(registry, null, 2)}\n`, { mode: OWNER_ONLY_FILE_MODE })
}

/** Insert or replace the entry with the same id. */
export function upsertPluginEntry(registry: PluginRegistry, entry: PluginRegistryEntry): PluginRegistry {
  return { plugins: [...registry.plugins.filter((p) => p.id !== entry.id), entry] }
}

export function removePluginEntry(registry: PluginRegistry, id: string): PluginRegistry {
  return { plugins: registry.plugins.filter((p) => p.id !== id) }
}
