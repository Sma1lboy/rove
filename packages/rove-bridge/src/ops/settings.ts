/**
 * Area ops behind the Settings home: usage meters, the daemon build notice, plugins on/off and
 * feedback. Engines live in `settings-engines.ts`.
 *
 * Deliberately absent, because each would let the phone make the Mac run something it authored:
 *  - plugin install / marketplace: installing runs the repo's own build commands;
 *  - plugin manifest settings: stored values become env vars of plugin-authored commands.
 */

import { isDaemonVersionStale } from "@sma1lboy/rove-daemon/daemon/protocol"
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
import { bool, flag, optText, text } from "./args.ts"
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
}

const realDeps: SettingsDeps = {
  usage: usageStore,
  bridgeVersion: CURRENT_VERSION,
  engineName: engineDisplayName,
  listPlugins: () => readPluginRows(),
  pluginIds: () => loadPluginRegistry().plugins.map((p) => p.id),
  setPluginEnabled: (id, enabled) => setPluginEnabled(id, enabled),
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
      wraps: "the orchestrator's usageSnapshotSignal (daemon usage.snapshot), held by the bridge",
      async run() {
        const rows = deps.usage.get()
        // `null` = the daemon has not reported yet; the app says so instead of showing zero meters.
        return {
          usage: rows === null ? null : rows.map((row) => ({ ...row, name: deps.engineName(row.vendor) })),
        }
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
