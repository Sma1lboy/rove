/**
 * Registered machines (`rove machine add`) and their connection state, for the sidebar's machine
 * headers (TUI `machine-layer.ts`). The bridge reads the same daemon `machines` feed the TUI does
 * and `machines.list` reports its `machinesSignal`; adding or removing a machine stays on the CLI.
 * `machines.repos` reads one machine's repos by id, for the composer's project list there.
 */

import type { MachineStatus } from "@sma1lboy/rove/src/machines/hub.ts"
import { BridgeError } from "../protocol.ts"
import { attempt, machineOf } from "./machine-outcome.ts"
import type { OpTable } from "./types.ts"

export interface MachineRepo {
  /** `host/owner/name`, or `root:<sha>` for a repo with no origin. */
  readonly id: string
  readonly primary: string | null
  readonly checkouts: readonly string[]
}

/** `repo-list`'s rows, keeping only well-formed ones: an older machine's reply must not break the picker. */
function repoRows(raw: unknown): MachineRepo[] {
  const rows = (raw as { repos?: unknown } | null)?.repos
  if (!Array.isArray(rows)) return []
  return rows.flatMap((row: { id?: unknown; primary?: unknown; checkouts?: unknown }) =>
    typeof row?.id === "string" && Array.isArray(row.checkouts)
      ? [
          {
            id: row.id,
            primary: typeof row.primary === "string" ? row.primary : null,
            checkouts: row.checkouts.filter((c): c is string => typeof c === "string"),
          },
        ]
      : [],
  )
}

export interface MachineRow {
  readonly alias: string
  readonly hostLabel: string
  readonly state: MachineStatus["state"]
  readonly version: string | null
}

export class MachineStore {
  private rows: readonly MachineRow[] = []

  set(statuses: readonly MachineStatus[]): void {
    this.rows = statuses.map((s) => ({
      alias: s.alias,
      hostLabel: s.hostLabel,
      state: s.state,
      version: s.version ?? null,
    }))
  }

  get(): readonly MachineRow[] {
    return this.rows
  }
}

/** The one the bridge process shares between its hub subscription and the op table. */
export const machineStore = new MachineStore()

export function createMachineOps(store: MachineStore = machineStore): OpTable {
  return {
    "machines.list": {
      kind: "read",
      destructive: false,
      wraps: "MachineFeed.machinesSignal (the daemon's machines channel, as the TUI sidebar shows it)",
      async run() {
        return { machines: store.get() }
      },
    },
    "machines.repos": {
      kind: "read",
      destructive: false,
      wraps: "repo-list (on `machine`): that machine's repos by id, with their checkouts",
      async run(args, ctx) {
        const machine = machineOf(args)
        if (!machine) throw new BridgeError("BAD_ARGS", "machine must name a registered machine")
        // A machine the hub already knows is not up is answered here: no ssh attempt for a list that cannot arrive.
        const state = store.get().find((row) => row.alias === machine)?.state
        if (state !== undefined && state !== "online") {
          const reason = state === "mismatch" || state === "unsupported" ? "outdated" : "offline"
          return { repos: [], reason, message: `machine "${machine}" is ${state}` }
        }
        const out = await attempt(ctx.api.verb<unknown>("repo-list", [], machine))
        return out.ok ? { repos: repoRows(out.result) } : { repos: [], reason: out.reason, message: out.message }
      },
    },
  }
}

export const machineOps: OpTable = createMachineOps()
