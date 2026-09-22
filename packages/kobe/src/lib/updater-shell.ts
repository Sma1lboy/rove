/**
 * Which shell runs `scripts/update.sh` (POSIX), and what to say when it is missing.
 *
 * Windows has no `sh` on PATH (Git for Windows adds only `…\Git\cmd`), so the
 * updater uses the same Git Bash {@link resolveLoginShell} finds for engines
 * and tabs. `update.sh` works unchanged there: its prefix derivation finds
 * nothing and falls back to a plain `npm install -g`, correct on Windows.
 *
 * POSIX stays bare `sh`, never `$SHELL` — a login fish/zsh is the wrong dialect.
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

/** `spawn … ENOENT` doesn't name the missing product (Git for Windows), so this does, plus the manual route. */
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
