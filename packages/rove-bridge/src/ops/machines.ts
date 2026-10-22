/**
 * Registered machines (`rove machine add`) and their connection state, for the sidebar's machine
 * headers (TUI `machine-layer.ts`). Read-only: the bridge reads the same daemon `machines` feed the TUI does
 * and this op reports its `machinesSignal`; adding or removing a machine stays on the CLI.
 */

import type { MachineStatus } from "@sma1lboy/rove/src/machines/hub.ts"
import type { OpTable } from "./types.ts"

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
  }
}

export const machineOps: OpTable = createMachineOps()
