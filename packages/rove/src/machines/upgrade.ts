/**
 * `rove machine update`: bring another machine's Rove up to this machine's release channel, from here.
 * The machine updates itself (`rove update` there) and restarts its own daemon, so it picks how:
 * a supervised daemon comes back through its supervisor. Sessions live in its PTY host and stay up.
 */

import { preferredReleaseChannel } from "../state/update-channel.ts"
import { discoverMachine, remoteRove, runOnMachine } from "./discover.ts"
import type { MachineEntry } from "./registry.ts"

export interface UpgradeResult {
  readonly alias: string
  /** The version it ran before and runs now; null when it could not say. */
  readonly from: string | null
  readonly to: string | null
  readonly changed: boolean
}

/** The seams {@link upgradeMachine} is tested through. */
export interface UpgradeDeps {
  readonly version: (entry: MachineEntry) => Promise<string | null>
  readonly run: (entry: MachineEntry, args: readonly string[], timeoutMs: number) => Promise<RemoteRun>
  readonly channel: () => string
}

interface RemoteRun {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

const DEFAULTS: UpgradeDeps = {
  version: async (entry) => {
    const found = await discoverMachine(entry.alias, entry)
    return found.ok ? found.status.roveVersion || null : null
  },
  run: (entry, args, timeoutMs) => runOnMachine(entry.alias, entry, remoteRove(entry.roveBin, args), { timeoutMs }),
  channel: preferredReleaseChannel,
}

const lastLines = (run: RemoteRun): string =>
  `${run.stdout}\n${run.stderr}`.trim().split("\n").slice(-6).join("\n") || `exit ${run.exitCode}`

/** Throws with that machine's own output when the install or the restart fails. */
export async function upgradeMachine(
  entry: MachineEntry,
  overrides: Partial<UpgradeDeps> = {},
): Promise<UpgradeResult> {
  const deps = { ...DEFAULTS, ...overrides }
  const { alias } = entry
  const from = await deps.version(entry)
  const install = await deps.run(entry, ["update", "--channel", deps.channel()], 600_000)
  if (install.exitCode !== 0) throw new Error(`rove update on ${alias} failed:\n${lastLines(install)}`)
  // The install replaced the files only: its daemon runs the old build until it restarts.
  const restart = await deps.run(entry, ["daemon", "restart"], 60_000)
  if (restart.exitCode !== 0) {
    throw new Error(`${alias} installed the update but its daemon did not restart:\n${lastLines(restart)}`)
  }
  const to = await deps.version(entry)
  return { alias, from, to, changed: to !== null && to !== from }
}
