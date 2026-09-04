/**
 * `ROVE_BIN_PATH` — the one thing a plugin execs to call back into Rove.
 *
 * It is a single exec token (the SDK spawns it directly), so it has to be
 * something runnable on its own. A bare name is the wrong answer whenever the
 * machine has more than one install: the daemon used to hand out the literal
 * `kobe`, so a hook fired by a 0.9.108 daemon reached whichever 0.9.105 sat
 * first on PATH — and a plugin's `listTasks()` could autospawn that other
 * version's daemon into this daemon's home.
 *
 * So: prefer an absolute path to the entry point this process is running,
 * and fall back to the name only when that entry cannot be exec'd on its own.
 */

import { accessSync, constants, statSync } from "node:fs"
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
 * Absolute when resolvable, else the invoked CLI name resolved on PATH.
 *
 * Three shapes:
 *  - **npm install** — `argv[1]` is `…/dist/cli/rove.js`: shebang + mode 755,
 *    so it runs on its own. This is the case the bug bit.
 *  - **compiled standalone** (`bun build --compile`) — the script lives in
 *    the embedded filesystem and `process.execPath` IS Rove.
 *  - **dev checkout** — `argv[1]` is `src/cli/rove.ts`, which needs `bun` in
 *    front and has no exec bit, so there is no single token for it: fall back
 *    to the name and accept that a dev daemon's hooks reach the installed CLI.
 */
export function resolvePluginBinPath(argv = process.argv, moduleUrl = import.meta.url): string {
  if (moduleUrl.includes("/$bunfs/") || moduleUrl.includes("B:\\~BUN")) return process.execPath
  const entry = argv[1]
  if (entry && isAbsolute(entry) && isRunnableFile(entry)) return entry
  return activeCliName()
}
