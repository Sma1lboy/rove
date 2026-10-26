/** The extended op allowlist: area tables, merged. An op not named here (or in core `OPS`) is UNKNOWN_OP. */

import { BridgeError } from "../protocol.ts"
import { devOps } from "./dev.ts"
import { filesOps } from "./files.ts"
import { GATE_OPS } from "./gates.ts"
import { insightOps } from "./insight.ts"
import { keybindingsOps } from "./keybindings.ts"
import { launchOps } from "./launch.ts"
import { machineOps } from "./machines.ts"
import { modsOps } from "./mods.ts"
import { pagesOps } from "./pages.ts"
import { panelOps } from "./panel.ts"
import { prefsOps } from "./prefs.ts"
import { promptOps } from "./prompts.ts"
import { routingOps } from "./routing.ts"
import { engineOps } from "./settings-engines.ts"
import { settingsOps } from "./settings.ts"
import { TASKOPS_OPS } from "./taskops.ts"
import { TASK_OPS } from "./tasks.ts"
import { TERMINAL_OPS } from "./terminal.ts"
import type { OpTable } from "./types.ts"
import { updateOps } from "./update.ts"
import { welcomeOps } from "./welcome.ts"
import { WORKSPACE_OPS } from "./workspace.ts"

/** Merge area tables; a name registered twice is a programming error, caught at startup and in tests. */
export function mergeOpTables(...tables: readonly OpTable[]): OpTable {
  const merged: Record<string, OpTable[string]> = {}
  for (const table of tables) {
    for (const [name, spec] of Object.entries(table)) {
      if (name in merged) throw new BridgeError("DUPLICATE_OP", `op ${name} is registered twice`)
      merged[name] = spec
    }
  }
  return merged
}

export const AREA_OPS: OpTable = mergeOpTables(
  TASK_OPS,
  TERMINAL_OPS,
  filesOps,
  GATE_OPS,
  pagesOps,
  settingsOps,
  engineOps,
  insightOps,
  updateOps,
  machineOps,
  devOps,
  prefsOps,
  routingOps,
  TASKOPS_OPS,
  WORKSPACE_OPS,
  welcomeOps,
  keybindingsOps,
  launchOps,
  modsOps,
  promptOps,
  panelOps,
)
