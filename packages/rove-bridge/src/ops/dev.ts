/**
 * Settings → Engines hook rows and the Dev section's two actions. None takes content from the
 * client: the hooks are the ones Rove writes itself, reset empties Rove's own files, restart
 * stops Rove's own daemon.
 */

import { unlinkSync } from "node:fs"
import { join } from "node:path"
import { roveStateDir } from "@sma1lboy/rove/src/env.ts"
import { replaceStateFile } from "@sma1lboy/rove/src/state/store.ts"
import { BridgeError } from "../protocol.ts"
import type { OpTable } from "./types.ts"

export interface DevDeps {
  readonly installHooks: () => Promise<void>
  readonly uninstallHooks: () => Promise<void>
  /** Empty state.json and remove the task index (the TUI's "Reset UI state"). */
  readonly resetState: () => void
}

/** Dynamic imports: a static edge from a render path to a CLI verb's module is a bundle-only TDZ crash (see `engine/hook-config-check.ts`). */
const realDeps: DevDeps = {
  installHooks: async () => {
    const { ensureGlobalRoveHooks } = await import("@sma1lboy/rove/src/cli/hook-cmd.ts")
    await ensureGlobalRoveHooks({ quiet: true })
  },
  uninstallHooks: async () => {
    const { activityHookAdapters } = await import("@sma1lboy/rove/src/engine/hook-adapter.ts")
    // Each engine on its own: one unwritable config must not abandon the rest.
    await Promise.all(
      activityHookAdapters().map(async (adapter) => {
        try {
          await adapter.removeActivityHooks(adapter.globalSettingsPath())
        } catch {
          /* unwritable or absent config: the next engines.settings read shows it stayed */
        }
      }),
    )
  },
  resetState: () => {
    replaceStateFile({})
    try {
      unlinkSync(join(roveStateDir(), "tasks.json"))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new BridgeError("RESET_FAILED", `could not remove tasks.json: ${(err as Error).message}`)
      }
    }
  },
}

export function createDevOps(deps: DevDeps): OpTable {
  return {
    "engines.hooks.install": {
      kind: "write",
      destructive: true,
      wraps: "Settings → Engines install row: ensureGlobalRoveHooks into every engine's own config",
      async run() {
        await deps.installHooks()
        return {}
      },
    },
    "engines.hooks.uninstall": {
      kind: "write",
      destructive: true,
      wraps: "Settings → Engines uninstall row: removeActivityHooks for every hook adapter",
      async run() {
        await deps.uninstallHooks()
        return {}
      },
    },
    "dev.reset": {
      kind: "write",
      destructive: true,
      wraps:
        "Settings → Dev reset: replaceStateFile({}), remove tasks.json, then daemon.stop {reason: restart} so its in-memory tasks go too (worktrees and engine history stay)",
      async run(_args, { api }) {
        deps.resetState()
        // The running daemon still holds the old index in memory; the TUI exits and relaunches, the web restarts the daemon.
        await api.rpc("daemon.stop", { reason: "restart" }).catch(() => undefined)
        return {}
      },
    },
    "daemon.restart": {
      kind: "write",
      destructive: true,
      wraps:
        "Settings → Dev restart: daemon RPC daemon.stop {reason: restart} (PTY host and engine sessions keep running)",
      async run(_args, { api }) {
        // The daemon may drop the link before it answers; that is the stop working.
        await api.rpc("daemon.stop", { reason: "restart" }).catch(() => undefined)
        return {}
      },
    },
  }
}

export const devOps: OpTable = createDevOps(realDeps)
