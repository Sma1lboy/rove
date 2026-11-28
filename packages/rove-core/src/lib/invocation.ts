/** How to re-invoke the active public CLI as a subprocess (packaged bin, or the dev runtime). */

import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { ROVE_PRODUCT_NAME } from "@sma1lboy/rove-core/product.ts"

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
export function roveCliInvocation(options: { sameInstall?: boolean } = {}): string[] {
  const cliName = ROVE_PRODUCT_NAME
  const isBuilt = import.meta.url.endsWith(".js")
  if (options.sameInstall) {
    if (import.meta.url.includes("/$bunfs/") || import.meta.url.includes("B:\\~BUN")) return [process.execPath]
    if (isBuilt) return [process.execPath, fileURLToPath(new URL(`./${cliName}-run.js`, import.meta.url))]
  }
  if (isBuilt) return [cliName]
  return [process.execPath, "--conditions=browser", devCliEntry()]
}

/**
 * argv prefix for commands PERSISTED into engine hook files. A dev entry path
 * (often in a worktree) goes stale when the worktree is removed ("Module not
 * found" on every fire), so prefer the packaged `rove` on PATH even in dev.
 */
export function roveHookInvocation(): string[] {
  if (import.meta.url.endsWith(".js")) return [ROVE_PRODUCT_NAME]
  if (Bun.which(ROVE_PRODUCT_NAME)) return [ROVE_PRODUCT_NAME]
  return roveCliInvocation()
}

/** The CLI's source entry, found through the package so it holds wherever this file lives. */
function devCliEntry(): string {
  return join(dirname(createRequire(import.meta.url).resolve("@sma1lboy/rove/package.json")), "src/cli/rove.ts")
}
