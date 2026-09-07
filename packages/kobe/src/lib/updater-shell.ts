/**
 * Which shell runs the GitHub-hosted update script, and what to say when it
 * is missing.
 *
 * `scripts/update.sh` is POSIX shell, and every caller used to spawn it as
 * bare `sh`. Windows has no `sh` on PATH: a default Git for Windows install
 * adds only `…\Git\cmd` (git.exe and friends), while `sh.exe`/`bash.exe`
 * live in `…\Git\bin`. So `rove update` — and the TUI's update chip, which
 * spawns the same way — died with a raw `spawn sh ENOENT` on a platform Rove
 * otherwise supports, leaving `npm install -g` by hand as the only route.
 *
 * The fix is not a second Windows dialect of the script: Rove already runs
 * every engine and terminal tab through Git for Windows' bash, and
 * {@link resolveLoginShell} is the one module that knows how to find it
 * (including why System32's `bash.exe` — the WSL launcher — must never be
 * used). This just points the updater at the same shell. `update.sh` itself
 * needs no changes: under Git Bash `command -v rove` lands on npm's shell
 * shim, the `lib/node_modules` prefix derivation finds nothing and falls
 * back to a plain `npm install -g`, which is the correct install on Windows.
 *
 * POSIX behaviour is deliberately unchanged — still bare `sh`, never `$SHELL`,
 * because a login fish/zsh is not the dialect the script is written in.
 */

import { resolveLoginShell } from "@sma1lboy/kobe-daemon/daemon/platform-shell"
import { recommendedGlobalInstallCommand } from "../version.ts"

type ShellDeps = {
  platform?: NodeJS.Platform
  env?: Readonly<Record<string, string | undefined>>
  /** Filesystem probe; injected so a `win32` resolution can be tested on POSIX. */
  exists?: (path: string) => boolean
}

/** The shell to spawn `update.sh` through: `sh` on POSIX, Git Bash on Windows. */
export function updaterShell(deps: ShellDeps = {}): string {
  const platform = deps.platform ?? process.platform
  if (platform !== "win32") return "sh"
  return resolveLoginShell({ fallback: "/bin/sh", platform, env: deps.env, exists: deps.exists })
}

/**
 * Extra lines for a spawn failure. `spawn … ENOENT` names the shell but not
 * the missing dependency, and on Windows the dependency is a whole product —
 * so say which one, and hand over the manual route in the same breath.
 */
export function updaterShellFailureHint(deps: ShellDeps = {}): string | null {
  const platform = deps.platform ?? process.platform
  if (platform !== "win32") return null
  return [
    "The update script is POSIX shell. Rove runs it through Git for Windows'",
    "bash — the same shell every engine and terminal tab launches through.",
    "Install Git for Windows (https://git-scm.com/download/win), or update",
    "by hand:",
    `  ${recommendedGlobalInstallCommand()}`,
    "",
  ].join("\n")
}
