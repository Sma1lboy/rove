/**
 * Keeps the other machines on this machine's release: one that connects on an older build is updated
 * (`upgrade.ts`) once nothing is running in its daemon. Never downgrades, and tries each machine once
 * per version it reports. state.json `machines.autoUpdate: false` turns it off.
 */

import { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import { logDaemonInfo } from "@sma1lboy/rove-daemon/daemon/crash-log"
import type { ReadableState } from "../lib/external-store.ts"
import { loadStateFile } from "../state/store.ts"
import { preferredReleaseChannel } from "../state/update-channel.ts"
import { CURRENT_VERSION, checkLatestVersion, isNewerSemver } from "../version.ts"
import { machineDaemonSocket } from "./forward.ts"
import type { MachineStatus } from "./hub.ts"
import { type MachineEntry, listMachines } from "./registry.ts"
import { type UpgradeResult, upgradeMachine } from "./upgrade.ts"
import { isWindowsMachine } from "./windows-remote.ts"

export const MACHINES_AUTO_UPDATE_KEY = "machines.autoUpdate"

/** The seams {@link startMachineAutoUpdate} is tested through. */
export interface AutoUpdateDeps {
  readonly hubVersion: string
  readonly enabled: () => boolean
  /** The newest build of this machine's channel; null when the registry cannot say. */
  readonly head: () => Promise<string | null>
  readonly entryOf: (alias: string) => MachineEntry | undefined
  /** A verb is running in that machine's daemon: a restart would cut it off. */
  readonly busy: (entry: MachineEntry) => Promise<boolean>
  readonly upgrade: (entry: MachineEntry) => Promise<UpgradeResult>
  readonly log: (line: string) => void
  readonly retryMs: number
}

const DEFAULTS: AutoUpdateDeps = {
  hubVersion: CURRENT_VERSION,
  enabled: () => loadStateFile()[MACHINES_AUTO_UPDATE_KEY] !== false,
  head: async () => (await checkLatestVersion({ force: true, channel: preferredReleaseChannel() }))?.latest ?? null,
  entryOf: (alias) => listMachines().find((m) => m.alias === alias),
  busy: async (entry) => {
    const socketPath = await machineDaemonSocket(entry)
    // Unreachable is not idle: leave it for the next look.
    if (!socketPath) return true
    const client = new RoveDaemonClient(socketPath)
    try {
      // An older daemon reports no count; it cannot be waited for.
      return ((await client.request<{ invoking?: number }>("daemon.status")).invoking ?? 0) > 0
    } catch {
      return true
    } finally {
      client.close()
    }
  },
  upgrade: upgradeMachine,
  // daemon.log, not the debug log: an install nobody asked for has to be findable afterwards.
  log: (line) => logDaemonInfo("machines", line),
  retryMs: 60_000,
}

export function startMachineAutoUpdate(
  machines: ReadableState<readonly MachineStatus[]>,
  overrides: Partial<AutoUpdateDeps> = {},
): () => void {
  const deps = { ...DEFAULTS, ...overrides }
  const tried = new Set<string>()
  const running = new Set<string>()
  let retry: ReturnType<typeof setTimeout> | null = null

  const attempt = async (alias: string, version: string): Promise<void> => {
    const key = `${alias}@${version}`
    const entry = deps.entryOf(alias)
    // ponytail: Windows machines are skipped; `rove update` over their ssh is unproven. `machine update` still works by hand.
    if (!entry || isWindowsMachine(entry)) return void tried.add(key)
    const head = await deps.head()
    // This machine runs a build its channel has not published: there is nothing to bring the other one up to.
    if (!head || !isNewerSemver(head, version)) return void tried.add(key)
    if (await deps.busy(entry)) {
      retry ??= setTimeout(() => {
        retry = null
        look()
      }, deps.retryMs)
      return
    }
    tried.add(key)
    const done = await deps.upgrade(entry)
    deps.log(
      done.changed
        ? `${alias} updated: ${done.from ?? "?"} → ${done.to ?? "?"}`
        : `${alias} had nothing newer to install`,
    )
  }

  const look = (): void => {
    if (!deps.enabled()) return
    for (const row of machines.get()) {
      if (row.state !== "online" || !row.version || row.duplicateOf) continue
      if (!isNewerSemver(deps.hubVersion, row.version)) continue
      if (tried.has(`${row.alias}@${row.version}`) || running.has(row.alias)) continue
      running.add(row.alias)
      attempt(row.alias, row.version)
        .catch((err: unknown) =>
          deps.log(`${row.alias} auto-update failed: ${err instanceof Error ? err.message : err}`),
        )
        .finally(() => running.delete(row.alias))
    }
  }

  const stop = machines.subscribe(look)
  look()
  return () => {
    stop()
    if (retry) clearTimeout(retry)
  }
}
