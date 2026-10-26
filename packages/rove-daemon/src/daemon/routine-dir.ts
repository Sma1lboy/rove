/** The working directory of a projectless routine: `<product home>/.rove/routines/<automation id>/`. */

import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { ROVE_STATE_DIR_BASENAME } from "../compat-env.ts"
import { resolveProductHomeDir } from "./product-paths.ts"

/** Keyed by the automation id, so renaming or rescheduling never moves a routine's cwd. */
export function routineDir(id: string, homeDir = resolveProductHomeDir()): string {
  return join(homeDir, ROVE_STATE_DIR_BASENAME, "routines", id)
}

/** The directory a run executes in: the repo, or the routine's own dir (created on demand) when projectless. */
export async function ensureRoutineCwd(automation: { id: string; repo?: string }): Promise<string> {
  if (automation.repo) return automation.repo
  const dir = routineDir(automation.id)
  await mkdir(dir, { recursive: true })
  return dir
}
