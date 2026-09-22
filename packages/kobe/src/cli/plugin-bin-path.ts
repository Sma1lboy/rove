/**
 * `ROVE_BIN_PATH`: the single exec token a plugin spawns to call back into
 * Rove. A bare name resolves to whichever install is first on PATH, which can
 * autospawn another version's daemon into this home — so prefer the absolute
 * entry point of this process; fall back to the name only when it can't exec
 * on its own.
 */

import { constants, accessSync, statSync } from "node:fs"
import { isAbsolute } from "node:path"
import { activeCliName } from "./rename-compat.ts"

function isRunnableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 *  - npm install: `argv[1]` is `…/dist/cli/rove.js` (shebang, mode 755).
 *  - compiled standalone: embedded fs; `process.execPath` IS Rove.
 *  - dev checkout: `src/cli/rove.ts` needs `bun` and has no exec bit, so fall
 *    back to the name — a dev daemon's hooks reach the installed CLI.
 */
export function resolvePluginBinPath(argv = process.argv, moduleUrl = import.meta.url): string {
  if (moduleUrl.includes("/$bunfs/") || moduleUrl.includes("B:\\~BUN")) return process.execPath
  const entry = argv[1]
  if (entry && isAbsolute(entry) && isRunnableFile(entry)) return entry
  return activeCliName()
}
