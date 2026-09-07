/**
 * `kobe plugin` — install, link, inspect, and invoke plugins.
 *
 * A plugin is a directory with a `rove-plugin.toml` manifest (the legacy
 * `kobe-plugin.toml` spelling remains accepted); the whole Rove CLI is the
 * plugin API. This command owns
 * the registry (`~/.rove/plugins.json`); the daemon's PluginHost watches
 * that file, so mutations here apply to a running daemon without a restart.
 */

import { spawnSync } from "node:child_process"
import { readFileSync, rmSync } from "node:fs"
import { errorMessage } from "@/lib/error-message"
import { defaultDaemonSocketPath } from "@sma1lboy/kobe-daemon/daemon/paths"
import { buildPluginEnv } from "@sma1lboy/kobe-daemon/plugins/env"
import {
  type PluginManifest,
  type PluginPlatform,
  currentPluginPlatform,
  qualifiedActionId,
  readPluginManifest,
  supportsPlatform,
} from "@sma1lboy/kobe-daemon/plugins/manifest"
import { buildPaneArgv } from "@sma1lboy/kobe-daemon/plugins/pane-command"
import { pluginCheckoutDir, pluginConfigDir, pluginLogPath } from "@sma1lboy/kobe-daemon/plugins/plugin-paths"
import {
  type PluginRegistryEntry,
  loadPluginRegistry,
  removePluginEntry,
  savePluginRegistry,
} from "@sma1lboy/kobe-daemon/plugins/registry"
import { flagValue } from "./argv.ts"
import { resolvePluginBinPath } from "./plugin-bin-path.ts"
import { PluginCliError, installPlugin, linkPlugin } from "./plugin-install.ts"
import { activeCliName } from "./rename-compat.ts"
import { SUBCOMMAND_VERBS } from "./subcommands.ts"

const CLI_NAME = activeCliName()

function printUsage(out: NodeJS.WriteStream): void {
  out.write(
    [
      `usage: ${CLI_NAME} plugin <command>`,
      "",
      "  install <owner/repo[/subdir]> [--yes] [--ref <rev>]   clone from GitHub, preview, build, register",
      "  link <dir>                                            register a local plugin directory (dev)",
      "  list                                                  installed + linked plugins",
      "  search [query]                                        browse the marketplace (GitHub topic rove-plugin)",
      "  outdated                                              check GitHub-installed plugins against upstream",
      "  update <id…> | --all [--yes]                          reinstall stale plugins from GitHub",
      "  enable <id> | disable <id>                            toggle a plugin without unregistering it",
      "  unlink <id>                                           unregister a linked plugin (files untouched)",
      "  uninstall <id-or-spec>                                unregister + remove the managed checkout",
      "  config-dir <id>                                       print the plugin's config directory",
      "  log <id> [-n <count>]                                 tail the plugin's command-run log",
      "  action list [--plugin <id>]                           declared actions",
      "  action invoke <plugin-id.action-id>                   run an action now",
      "  pane open <plugin-id.pane-id> [--task <task-id>]      open a plugin pane as a terminal tab (JSON:",
      "                                                        clients — 0 = no attached UI performed the split)",
      "",
      "Marketplace: https://github.com/topics/rove-plugin (legacy kobe-plugin is included)",
      "",
    ].join("\n"),
  )
}

interface LoadedEntry {
  readonly entry: PluginRegistryEntry
  readonly manifest: PluginManifest | undefined
}

function loadAll(): LoadedEntry[] {
  return loadPluginRegistry().plugins.map((entry) => {
    try {
      return { entry, manifest: readPluginManifest(entry.root).manifest }
    } catch {
      return { entry, manifest: undefined }
    }
  })
}

function requireEntry(id: string): PluginRegistryEntry {
  const entry = loadPluginRegistry().plugins.find((p) => p.id === id)
  if (!entry) throw new PluginCliError(`no plugin registered as \`${id}\`; see \`${CLI_NAME} plugin list\``)
  return entry
}

function listPlugins(): void {
  const all = loadAll()
  if (all.length === 0) {
    console.log(
      `no plugins installed. Try: ${CLI_NAME} plugin install <owner/repo> — browse the \`rove-plugin\` GitHub topic.`,
    )
    return
  }
  for (const { entry, manifest } of all) {
    const state = entry.enabled ? "enabled" : "disabled"
    const kind = entry.source.kind === "link" ? `linked ${entry.root}` : entry.source.spec
    const broken = manifest ? "" : "  [manifest unreadable]"
    console.log(`${entry.id}  v${entry.version}  ${state}  (${kind})${broken}`)
  }
}

function setEnabled(id: string, enabled: boolean): void {
  const entry = requireEntry(id)
  const registry = loadPluginRegistry()
  savePluginRegistry({
    plugins: registry.plugins.map((p) => (p.id === id ? { ...entry, enabled } : p)),
  })
  console.log(`${enabled ? "enabled" : "disabled"} ${id}`)
}

function unlink(id: string): void {
  const entry = requireEntry(id)
  if (entry.source.kind !== "link") throw new PluginCliError(`\`${id}\` is a GitHub install; use uninstall`)
  savePluginRegistry(removePluginEntry(loadPluginRegistry(), id))
  console.log(`unlinked ${id} (files untouched at ${entry.root})`)
}

function uninstall(idOrSpec: string): void {
  const registry = loadPluginRegistry()
  const entry = registry.plugins.find(
    (p) => p.id === idOrSpec || (p.source.kind === "github" && p.source.spec === idOrSpec),
  )
  if (!entry) throw new PluginCliError(`no plugin registered as \`${idOrSpec}\``)
  if (entry.source.kind === "link") throw new PluginCliError(`\`${entry.id}\` is linked; use unlink`)
  savePluginRegistry(removePluginEntry(registry, entry.id))
  // Managed checkout goes; config/ and state/ stay so a reinstall keeps user data.
  rmSync(pluginCheckoutDir(entry.id), { recursive: true, force: true })
  console.log(`uninstalled ${entry.id} (config/state kept under ~/.rove/plugins/${entry.id}/)`)
}

function listActions(pluginFilter?: string): void {
  for (const { entry, manifest } of loadAll()) {
    if (!manifest || (pluginFilter && entry.id !== pluginFilter)) continue
    for (const action of manifest.actions) {
      console.log(`${qualifiedActionId(entry.id, action.id)}  ${action.title}`)
    }
  }
}

/**
 * Plugin ids may contain dots, so a naive `<id>.<local>` split is wrong.
 * Match registered ids by longest prefix, then let the caller pick the local
 * item (action or pane) from the suffix.
 */
function findByLongestPluginPrefix<T>(
  qualified: string,
  options: { enabledOnly?: boolean },
  findItem: (manifest: PluginManifest, suffix: string) => T | undefined,
): { entry: PluginRegistryEntry; manifest: PluginManifest; item: T } | undefined {
  type LoadedWithManifest = { readonly entry: PluginRegistryEntry; readonly manifest: PluginManifest }
  for (const { entry, manifest } of (loadAll() as LoadedWithManifest[])
    .filter(({ entry, manifest }) =>
      Boolean(manifest && (!options.enabledOnly || entry.enabled) && qualified.startsWith(`${entry.id}.`)),
    )
    .sort((a, b) => b.entry.id.length - a.entry.id.length)) {
    const item = findItem(manifest, qualified.slice(entry.id.length + 1))
    if (item !== undefined) return { entry, manifest, item }
  }
  return undefined
}

/**
 * Refuse to run something the manifest says this machine cannot run. The
 * daemon's host and the TUI's pane picker have always skipped these; the CLI
 * ran them anyway, so `platforms` meant nothing from a shell.
 */
function assertPlatformSupported(
  label: string,
  item: { readonly platforms?: readonly PluginPlatform[] },
  manifest: PluginManifest,
): void {
  if (supportsPlatform(item, manifest, currentPluginPlatform())) return
  const declared = (item.platforms ?? manifest.platforms ?? []).join(", ")
  throw new PluginCliError(`\`${label}\` is not supported on this platform (declares ${declared})`)
}

function invokeAction(qualified: string, extraArgs: string[]): void {
  const hit = findByLongestPluginPrefix(qualified, { enabledOnly: true }, (manifest, actionId) =>
    manifest.actions.find((a) => a.id === actionId),
  )
  if (!hit) throw new PluginCliError(`no action \`${qualified}\`; see \`${CLI_NAME} plugin action list\``)
  assertPlatformSupported(qualified, hit.item, hit.manifest)

  // Extra CLI args are appended to the action's argv so an action can take
  // an argument (`<active CLI> plugin action invoke p.start <url>`).
  const action = hit.item
  const [cmd, ...args] = [...action.command, ...extraArgs]
  const res = spawnSync(cmd as string, args, {
    cwd: hit.entry.root,
    stdio: "inherit",
    env: buildPluginEnv({
      socketPath: defaultDaemonSocketPath(),
      binPath: resolvePluginBinPath(),
      pluginId: hit.entry.id,
      pluginRoot: hit.entry.root,
      extra: { ROVE_PLUGIN_ACTION_ID: action.id, ROVE_PLUGIN_INVOKE_CWD: process.cwd() },
    }),
  })
  process.exit(res.status ?? 1)
}

/** Resolve `<plugin-id>.<pane-id>` (plugin ids may contain dots — longest registered prefix wins). */
function resolvePaneQualified(qualified: string): { pluginId: string; entrypoint: string } {
  const hit = findByLongestPluginPrefix(qualified, { enabledOnly: false }, (manifest, entrypoint) =>
    manifest.panes.find((p) => p.id === entrypoint),
  )
  if (!hit) throw new PluginCliError(`no pane \`${qualified}\`; see \`${CLI_NAME} plugin list\``)
  return { pluginId: hit.entry.id, entrypoint: hit.item.id }
}

async function openPane(pluginId: string, entrypoint: string, taskFlag: string | undefined): Promise<void> {
  const loaded = loadAll().find(({ entry }) => entry.id === pluginId)
  if (!loaded?.manifest) throw new PluginCliError(`no plugin \`${pluginId}\` (or its manifest is unreadable)`)
  if (!loaded.entry.enabled) throw new PluginCliError(`\`${pluginId}\` is disabled`)
  const pane = loaded.manifest.panes.find((p) => p.id === entrypoint)
  if (!pane) throw new PluginCliError(`no pane \`${entrypoint}\` in \`${pluginId}\`; declare it under [[panes]]`)
  assertPlatformSupported(`${pluginId}.${pane.id}`, pane, loaded.manifest)

  const { openDaemonSession, resolveActiveTaskId } = await import("./daemon-session.ts")
  const session = await openDaemonSession({ mode: "start" })
  try {
    const taskId = taskFlag ?? (await resolveActiveTaskId(session.client))
    if (!taskId) throw new PluginCliError("no active task; pass --task <id>")
    // Resolve the task BEFORE composing argv: its id rides the env contract
    // into the pane, so the pane can name the task it runs in instead of
    // guessing from its cwd.
    // Shared composition with the TUI's ctrl+e picker (plugins/pane-command.ts):
    // one login-shell `-ilc` script, env contract riding an `env` prefix, cwd = worktree.
    const argv = buildPaneArgv(loaded.entry.id, loaded.entry.root, pane, {
      socketPath: defaultDaemonSocketPath(),
      binPath: resolvePluginBinPath(),
      taskId,
    })
    const reply = (await session.client.request("tab.open", {
      taskId,
      argv,
      title: pane.title,
      placement: pane.placement,
    })) as Record<string, unknown> | undefined
    // Same machine-readable shape as `api pane-open`: `clients` is the only
    // way a caller can tell "nobody performed the split" from "opened" —
    // exit 0 alone means the broadcast went out, not that a UI acted on it.
    console.log(JSON.stringify({ ...reply, ok: true, pane: `${pluginId}.${pane.id}`, taskId, title: pane.title }))
  } finally {
    session.close()
  }
}

function tailLog(id: string, count: number): void {
  requireEntry(id)
  let text: string
  try {
    text = readFileSync(pluginLogPath(id), "utf8")
  } catch {
    console.log("(no runs logged yet)")
    return
  }
  const lines = text.trimEnd().split("\n")
  for (const line of lines.slice(-count)) console.log(line)
}

export async function runPluginSubcommand(rest: string[]): Promise<void> {
  const [command, ...args] = rest
  // The switch below dispatches, but `subcommands.ts` decides what is a verb
  // at all — so `kobe completions` offers exactly this set, and a case added
  // without listing it there is unreachable instead of silently uncompletable.
  if (command !== undefined && !SUBCOMMAND_VERBS.plugin.includes(command)) {
    const isHelp = command === "help" || command === "--help" || command === "-h"
    printUsage(isHelp ? process.stdout : process.stderr)
    if (!isHelp) process.exit(2)
    return
  }
  try {
    switch (command) {
      case "install": {
        const spec = args.find((a) => !a.startsWith("-"))
        if (!spec) throw new PluginCliError("install needs <owner/repo[/subdir]>")
        await installPlugin(spec, { yes: args.includes("--yes"), ref: flagValue(args, "--ref") })
        return
      }
      case "link": {
        if (!args[0]) throw new PluginCliError("link needs a directory")
        linkPlugin(args[0])
        return
      }
      case "list":
        listPlugins()
        return
      case "search": {
        const { searchMarketplace } = await import("./plugin-search.ts")
        await searchMarketplace(args.find((a) => !a.startsWith("-")))
        return
      }
      case "outdated": {
        const { printOutdated } = await import("./plugin-update.ts")
        printOutdated()
        return
      }
      case "update": {
        const { updatePlugins } = await import("./plugin-update.ts")
        await updatePlugins(
          args.filter((a) => !a.startsWith("-")),
          { all: args.includes("--all"), yes: args.includes("--yes") },
        )
        return
      }
      case "enable":
      case "disable": {
        if (!args[0]) throw new PluginCliError(`${command} needs a plugin id`)
        setEnabled(args[0], command === "enable")
        return
      }
      case "unlink": {
        if (!args[0]) throw new PluginCliError("unlink needs a plugin id")
        unlink(args[0])
        return
      }
      case "uninstall": {
        if (!args[0]) throw new PluginCliError("uninstall needs a plugin id or owner/repo spec")
        uninstall(args[0])
        return
      }
      case "config-dir": {
        if (!args[0]) throw new PluginCliError("config-dir needs a plugin id")
        requireEntry(args[0])
        console.log(pluginConfigDir(args[0]))
        return
      }
      case "log": {
        if (!args[0]) throw new PluginCliError("log needs a plugin id")
        tailLog(args[0], Number.parseInt(flagValue(args, "-n") ?? "20", 10) || 20)
        return
      }
      case "pane": {
        const [sub, ...paneArgs] = args
        if (sub === "open") {
          const positional = paneArgs.find((a) => !a.startsWith("-") && a !== flagValue(paneArgs, "--task"))
          let pluginId = flagValue(paneArgs, "--plugin")
          let entrypoint = flagValue(paneArgs, "--entrypoint")
          if (!pluginId || !entrypoint) {
            if (!positional) {
              throw new PluginCliError(
                "pane open needs <plugin-id.pane-id> (or --plugin <id> --entrypoint <pane-id>) [--task <task-id>]",
              )
            }
            ;({ pluginId, entrypoint } = resolvePaneQualified(positional))
          }
          await openPane(pluginId, entrypoint, flagValue(paneArgs, "--task"))
          return
        }
        printUsage(process.stderr)
        process.exit(2)
        return
      }
      case "action": {
        const [sub, ...actionArgs] = args
        if (sub === "list") {
          listActions(flagValue(actionArgs, "--plugin"))
          return
        }
        if (sub === "invoke") {
          if (!actionArgs[0]) throw new PluginCliError("action invoke needs <plugin-id.action-id>")
          invokeAction(actionArgs[0], actionArgs.slice(1))
          return
        }
        printUsage(process.stderr)
        process.exit(2)
        return
      }
      default: {
        const isHelp = command === undefined || command === "help" || command === "--help" || command === "-h"
        printUsage(isHelp ? process.stdout : process.stderr)
        if (!isHelp) process.exit(2)
        return
      }
    }
  } catch (err) {
    if (err instanceof PluginCliError) {
      console.error(`${CLI_NAME} plugin: ${err.message}`)
      process.exit(1)
    }
    console.error(`${CLI_NAME} plugin: ${errorMessage(err)}`)
    process.exit(1)
  }
}
