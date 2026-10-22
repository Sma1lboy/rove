/**
 * Area ops behind the Settings home: usage meters, the daemon build notice, plugins on/off and
 * feedback. Engines live in `settings-engines.ts`.
 *
 * Deliberately absent, because each would let the phone make the Mac run something it authored:
 *  - plugin install / marketplace: installing runs the repo's own build commands (a first-party
 *    mod's install runs nothing, so `builtinMod.setInstalled` is here);
 *  - plugin manifest settings: stored values become env vars of plugin-authored commands.
 */

import { isDaemonVersionStale } from "@sma1lboy/rove-daemon/daemon/protocol"
import {
  BUILTIN_MODS,
  type BuiltinModId,
  installedBuiltinMods,
  isBuiltinModId,
  setBuiltinModInstalled,
} from "@sma1lboy/rove-daemon/plugins/builtin-mods"
import { loadPluginRegistry } from "@sma1lboy/rove-daemon/plugins/registry"
import { engineDisplayName } from "@sma1lboy/rove/src/engine/interactive-command.ts"
import {
  type PluginRowView,
  readPluginRows,
  setPluginEnabled,
} from "@sma1lboy/rove/src/tui-react/component/settings-dialog/plugins-core.ts"
import { CURRENT_VERSION } from "@sma1lboy/rove/src/version.ts"
import { BridgeError } from "../protocol.ts"
import { type UsageStore, usageStore } from "../usage-store.ts"
import { bool, flag, optText, tabId, taskId, text } from "./args.ts"
import type { OpTable } from "./types.ts"

const PLUGIN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const CATEGORY = /^[a-z0-9][a-z0-9-]{0,39}$/

export interface SettingsDeps {
  readonly usage: UsageStore
  /** The Rove build this bridge runs; the daemon is "out of date" when it differs. */
  readonly bridgeVersion: string
  /** Display name for an engine id in the usage meters. */
  readonly engineName: (id: string) => string
  readonly listPlugins: () => readonly PluginRowView[]
  readonly pluginIds: () => readonly string[]
  readonly setPluginEnabled: (id: string, enabled: boolean) => void
  readonly installedMods: () => readonly BuiltinModId[]
  readonly setModInstalled: (id: BuiltinModId, installed: boolean) => void
}

const realDeps: SettingsDeps = {
  usage: usageStore,
  bridgeVersion: CURRENT_VERSION,
  engineName: engineDisplayName,
  listPlugins: () => readPluginRows(),
  pluginIds: () => loadPluginRegistry().plugins.map((p) => p.id),
  setPluginEnabled: (id, enabled) => setPluginEnabled(id, enabled),
  installedMods: () => installedBuiltinMods(),
  setModInstalled: (id, installed) => setBuiltinModInstalled(id, installed),
}

interface DaemonStatus {
  readonly roveVersion?: string
  readonly uptimeMs?: number
  readonly startedAt?: string
  readonly attachedClients?: number
  readonly automationHold?: boolean
  readonly taskCount?: number
}

export function createSettingsOps(deps: SettingsDeps): OpTable {
  return {
    "usage.get": {
      kind: "read",
      destructive: false,
      wraps:
        "the orchestrator's usageSnapshotSignal (daemon usage.snapshot) and, given taskId+tabId, its contextUsageSignal for that session; both held by the bridge",
      async run(args) {
        const rows = deps.usage.get()
        // `null` = the daemon has not reported yet; the app says so instead of showing zero meters.
        const usage = rows === null ? null : rows.map((row) => ({ ...row, name: deps.engineName(row.vendor) }))
        if (args.taskId === undefined) return { usage }
        // The footer's ctx% and Σ for one session; null = no reading (never a 0).
        return { usage, context: deps.usage.context(`${taskId(args)}::${tabId(args)}`) }
      },
    },
    "daemon.info": {
      kind: "read",
      destructive: false,
      wraps: "daemon RPC daemon.status, compared with the bridge's own Rove build (isDaemonVersionStale)",
      async run(_args, { api }) {
        const status = await api.rpc<DaemonStatus>("daemon.status", {})
        return {
          daemonVersion: status.roveVersion ?? null,
          bridgeVersion: deps.bridgeVersion,
          stale: isDaemonVersionStale(status.roveVersion, deps.bridgeVersion),
          ...(status.uptimeMs !== undefined ? { uptimeMs: status.uptimeMs } : {}),
          ...(status.startedAt !== undefined ? { startedAt: status.startedAt } : {}),
          ...(status.taskCount !== undefined ? { taskCount: status.taskCount } : {}),
          ...(status.attachedClients !== undefined ? { attachedClients: status.attachedClients } : {}),
          ...(status.automationHold !== undefined ? { automationHold: status.automationHold } : {}),
        }
      },
    },
    "plugins.list": {
      kind: "read",
      destructive: false,
      wraps: "settings Plugins section's readPluginRows (registry + manifest + last run)",
      async run() {
        return {
          plugins: deps.listPlugins().map((p) => ({
            id: p.id,
            version: p.version,
            enabled: p.enabled,
            linked: p.linked,
            platformOk: p.platformOk,
            hooksDeclared: p.hooksDeclared,
            updateAvailable: p.updateAvailable,
            declares: p.declares,
            lastRun: p.lastRun
              ? { at: p.lastRun.at, label: p.lastRun.label, ok: p.lastRun.ok, running: p.lastRun.running }
              : null,
          })),
        }
      },
    },
    "plugin.setEnabled": {
      kind: "write",
      destructive: true,
      wraps: "settings Plugins section's setPluginEnabled (plugins.json; the daemon file-watches it)",
      async run(args) {
        const id = text(args, "id", 64)
        if (!PLUGIN_ID.test(id) || !deps.pluginIds().includes(id)) {
          throw new BridgeError("BAD_ARGS", `${id} is not an installed plugin`)
        }
        const enabled = bool(args, "enabled")
        deps.setPluginEnabled(id, enabled)
        return { id, enabled }
      },
    },
    "builtinMods.list": {
      kind: "read",
      destructive: false,
      wraps: "builtin-mods.json: the first-party mods (Kanban, Issues) and which are installed",
      async run() {
        const installed = new Set(deps.installedMods())
        return {
          mods: BUILTIN_MODS.map((mod) => ({
            id: mod.id,
            name: mod.name,
            description: mod.description,
            installed: installed.has(mod.id),
          })),
        }
      },
    },
    "builtinMod.setInstalled": {
      kind: "write",
      // Uninstalling only hides the feature; its data stays and a reinstall picks it up.
      destructive: false,
      wraps: "builtin-mods.json (the TUI, the daemon and `rove api` read the same file)",
      async run(args) {
        const id = text(args, "id", 64)
        if (!isBuiltinModId(id)) throw new BridgeError("BAD_ARGS", `${id} is not a first-party mod`)
        const installed = bool(args, "installed")
        deps.setModInstalled(id, installed)
        return { id, installed }
      },
    },
    "feedback.send": {
      kind: "write",
      // A public GitHub Discussion cannot be unsent.
      destructive: true,
      wraps: "rove api feedback (GitHub Discussion in the Rove repo's Feedback category, via gh)",
      run(args, { api }) {
        const argv = [flag("title", text(args, "title", 200).trim()), flag("body", text(args, "body", 10_000))]
        const category = optText(args, "category", 40)
        if (category !== undefined) {
          if (!CATEGORY.test(category)) throw new BridgeError("BAD_ARGS", "category is not a category slug")
          argv.push(flag("category", category))
        }
        return api.verb("feedback", argv)
      },
    },
  }
}

export const settingsOps: OpTable = createSettingsOps(realDeps)
