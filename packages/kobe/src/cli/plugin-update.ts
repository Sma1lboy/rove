/**
 * `kobe plugin outdated|update` for GitHub installs: `git ls-remote HEAD` vs
 * the checkout's HEAD; update = reinstall (config/state live outside the
 * checkout). Linked plugins are never touched. Every check rewrites the
 * outdated cache Settings reads — the TUI never hits the network.
 */

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, renameSync } from "node:fs"
import { join } from "node:path"
import { writeOutdatedCache } from "@sma1lboy/kobe-daemon/plugins/outdated-cache"
import {
  pluginCheckoutDir,
  pluginConfigDir,
  pluginDataDir,
  pluginStateDir,
} from "@sma1lboy/kobe-daemon/plugins/plugin-paths"
import {
  type PluginRegistryEntry,
  loadPluginRegistry,
  removePluginEntry,
  savePluginRegistry,
} from "@sma1lboy/kobe-daemon/plugins/registry"
import { PluginCliError, installPlugin } from "./plugin-install.ts"
import { activeCliName } from "./rename-compat.ts"

interface OutdatedRow {
  readonly id: string
  readonly spec: string
  readonly version: string
  /** null when the checkout has no readable git HEAD. */
  readonly localSha: string | null
  /** null when the remote probe failed (offline, repo gone). */
  readonly remoteSha: string | null
  readonly behind: boolean
}

function gitOut(args: string[], cwd?: string): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
  } catch {
    return null
  }
}

function checkEntry(entry: PluginRegistryEntry & { source: { kind: "github"; spec: string } }): OutdatedRow {
  const repoSpec = entry.source.spec.split("/").slice(0, 2).join("/")
  const localSha = gitOut(["rev-parse", "HEAD"], pluginCheckoutDir(entry.id))
  const remote = gitOut(["ls-remote", `https://github.com/${repoSpec}.git`, "HEAD"])
  const remoteSha = remote ? (remote.split(/\s+/)[0] ?? null) : null
  return {
    id: entry.id,
    spec: entry.source.spec,
    version: entry.version,
    localSha,
    remoteSha,
    behind: Boolean(localSha && remoteSha && localSha !== remoteSha),
  }
}

/** Probe every GitHub-installed plugin; refreshes the Settings cache. */
function listOutdated(): OutdatedRow[] {
  const rows = loadPluginRegistry()
    .plugins.filter(
      (p): p is PluginRegistryEntry & { source: { kind: "github"; spec: string } } => p.source.kind === "github",
    )
    .map(checkEntry)
  writeOutdatedCache(rows.filter((r) => r.behind).map((r) => r.id))
  return rows
}

export function printOutdated(): void {
  const rows = listOutdated()
  if (rows.length === 0) {
    console.log("no GitHub-installed plugins.")
    return
  }
  for (const r of rows) {
    const status = r.behind
      ? "update available"
      : r.remoteSha === null
        ? "remote unreachable"
        : r.localSha === null
          ? "local sha unreadable"
          : "up to date"
    console.log(`${r.id}  v${r.version}  ${status}`)
  }
}

/**
 * A renamed plugin installs under its new id, leaving the old entry firing
 * every hook too. Carry data over and unregister the old id; the stale
 * checkout is left and reported, so a rename never loses configuration.
 */
function migrateRenamedPlugin(oldId: string, newId: string): void {
  for (const dirOf of [pluginConfigDir, pluginStateDir]) {
    const from = dirOf(oldId)
    const to = dirOf(newId)
    if (!existsSync(from)) continue
    mkdirSync(to, { recursive: true })
    // Never clobber what the fresh install already created.
    for (const entry of readdirSync(from)) {
      if (existsSync(join(to, entry))) continue
      renameSync(join(from, entry), join(to, entry))
    }
  }
  savePluginRegistry(removePluginEntry(loadPluginRegistry(), oldId))
  console.log(`renamed ${oldId} → ${newId}: settings and state carried over, old entry unregistered`)
  console.log(`  leftover checkout (safe to remove): ${pluginDataDir(oldId)}`)
}

/** Reinstall the named plugins — or with `all`, every stale one. */
export async function updatePlugins(ids: readonly string[], opts: { all: boolean; yes: boolean }): Promise<void> {
  const rows = listOutdated()
  let targets: OutdatedRow[]
  if (opts.all) {
    targets = rows.filter((r) => r.behind)
    if (targets.length === 0) {
      console.log("all plugins up to date.")
      return
    }
  } else {
    if (ids.length === 0) throw new PluginCliError("update takes plugin ids or --all")
    targets = ids.map((id) => {
      const row = rows.find((r) => r.id === id)
      if (!row)
        throw new PluginCliError(`\`${id}\` is not a GitHub-installed plugin; see \`${activeCliName()} plugin list\``)
      return row
    })
  }
  for (const target of targets) {
    if (!target.behind && !ids.includes(target.id)) continue
    console.log(`updating ${target.id} (${target.spec})…`)
    const installedId = await installPlugin(target.spec, { yes: opts.yes })
    if (installedId !== target.id) migrateRenamedPlugin(target.id, installedId)
  }
  // Reinstall moved HEADs — refresh the cache so Settings drops its marks.
  listOutdated()
}
