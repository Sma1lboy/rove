/** The extended op allowlist: area tables, merged. An op not named here (or in core `OPS`) is UNKNOWN_OP. */

import { BridgeError } from "../protocol.ts"
import { filesOps } from "./files.ts"
import { insightOps } from "./insight.ts"
import { pagesOps } from "./pages.ts"
import { engineOps } from "./settings-engines.ts"
import { settingsOps } from "./settings.ts"
import { TASK_OPS } from "./tasks.ts"
import { TERMINAL_OPS } from "./terminal.ts"
import type { OpTable } from "./types.ts"

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
  pagesOps,
  settingsOps,
  engineOps,
  insightOps,
)
