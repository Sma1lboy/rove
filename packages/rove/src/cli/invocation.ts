/** How to re-invoke the active public CLI as a subprocess (packaged bin, or the dev runtime). */

import { fileURLToPath } from "node:url"
import { LEGACY_KOBE_PRODUCT_NAME, ROVE_PRODUCT_NAME } from "../product.ts"
import { activeCliName } from "./rename-compat.ts"

/**
 * argv prefix that runs the active CLI. Append the subcommand + flags:
 *
 *   [...roveCliInvocation(), "ops", "--worktree", wt]
 *
 * Packaged build → `[<active-name>]` (npm bin shim on PATH). Dev → `[<bun>,
 * "--conditions=browser", <cli entry>]`.
 *
 * `browser` condition is required: opentui resolves a browser-conditioned
 * entry (the build passes it too). JSX pragmas need no preload. (Spelling the
 * pragma out here makes knip report an unlisted dependency.)
 */
export function roveCliInvocation(): string[] {
  const cliName = activeCliName()
  const isBuilt = import.meta.url.endsWith(".js")
  if (isBuilt) return [cliName]
  const entryName = cliName === ROVE_PRODUCT_NAME ? "rove.ts" : "kobe.ts"
  const entry = fileURLToPath(new URL(`./${entryName}`, import.meta.url))
  return [process.execPath, "--conditions=browser", entry]
}

/**
 * argv prefix for commands PERSISTED into engine hook files. A dev entry path
 * (often in a worktree) goes stale when the worktree is removed ("Module not
 * found" on every fire), so prefer the packaged `kobe` on PATH even in dev.
 */
export function kobeHookInvocation(): string[] {
  // `kobe`, not `rove`: guaranteed on PATH throughout rename phase 1.
  if (import.meta.url.endsWith(".js")) return [LEGACY_KOBE_PRODUCT_NAME]
  if (Bun.which(LEGACY_KOBE_PRODUCT_NAME)) return [LEGACY_KOBE_PRODUCT_NAME]
  return roveCliInvocation()
}
