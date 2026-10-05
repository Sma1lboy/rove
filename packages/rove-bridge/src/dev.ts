/**
 * `bun run dev` — the bridge against the dev:sandbox Rove home, never the
 * real ~/.rove. Same home resolution as `bun dev:sandbox` (shared across
 * worktrees; `--name <x>` for a named instance; `ROVE_SANDBOX_HOME_DIR` wins).
 * Remaining argv goes to the bridge.
 */

import { spawn, spawnSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { sandboxChildEnv } from "@sma1lboy/rove/scripts/dev-sandbox-env.ts"

const argv = process.argv.slice(2)
let name: string | undefined
const nameAt = argv.indexOf("--name")
if (nameAt !== -1) {
  name = argv[nameAt + 1]
  if (!name) throw new Error("--name needs a value")
  argv.splice(nameAt, 2)
}

function sandboxHome(): string {
  const explicit = process.env.ROVE_SANDBOX_HOME_DIR?.trim()
  if (explicit) return explicit
  const common = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" })
  if (common.status !== 0) throw new Error(`git rev-parse failed: ${common.stderr}`)
  const base = join(dirname(common.stdout.trim()), "packages", "rove", ".dev-sandbox")
  return name ? join(base, "named", name, "home") : join(base, "home")
}

const home = sandboxHome()
mkdirSync(home, { recursive: true })
console.error(`[rove-bridge dev] sandbox home: ${home}`)
const main = join(dirname(fileURLToPath(import.meta.url)), "main.ts")
const child = spawn(process.execPath, [main, ...argv], { stdio: "inherit", env: sandboxChildEnv(home) })
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => child.kill(sig))
