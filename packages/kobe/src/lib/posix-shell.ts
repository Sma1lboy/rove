/**
 * The POSIX shell Rove runs its own shell commands through, and what to say
 * when there isn't one.
 *
 * Rove composes POSIX shell strings in several places — the update script,
 * the "is this binary installed" probe, the editor launch line. Every caller
 * used to spawn them as bare `sh`. Windows has no `sh` on PATH: a default
 * Git for Windows install adds only `…\Git\cmd` (git.exe and friends), while
 * `sh.exe`/`bash.exe` live in `…\Git\bin`. Each call site therefore failed on
 * a platform Rove otherwise supports, and failed differently: the updater
 * with a raw `spawn sh ENOENT`, the editor probe silently (its throw is
 * caught into "not installed"), `rove config` with an error blaming the very
 * setting the user had already set.
 *
 * The answer is not a second Windows dialect: Rove already runs every engine
 * and terminal tab through Git for Windows' bash, and {@link resolveLoginShell}
 * is the one module that knows how to find it — including why System32's
 * `bash.exe`, the WSL launcher, must never be used (it would address a Linux
 * filesystem that cannot see the Windows worktree).
 *
 * POSIX behaviour is deliberately unchanged — still bare `sh`, never `$SHELL`,
 * because a login fish/zsh is not the dialect these strings are written in.
 *
 * Path form matters as much as the shell: see {@link toPosixPath}, which every
 * path interpolated INTO one of these command strings goes through.
 */

import { resolveLoginShell } from "@sma1lboy/kobe-daemon/daemon/platform-shell"

type ShellDeps = {
  platform?: NodeJS.Platform
  env?: Readonly<Record<string, string | undefined>>
  /** Filesystem probe; injected so a `win32` resolution can be tested on POSIX. */
  exists?: (path: string) => boolean
}

/** The shell to spawn a POSIX command string through: `sh`, or Git Bash on Windows. */
export function posixShell(deps: ShellDeps = {}): string {
  const platform = deps.platform ?? process.platform
  if (platform !== "win32") return "sh"
  return resolveLoginShell({ fallback: "/bin/sh", platform, env: deps.env, exists: deps.exists })
}

/**
 * Why the spawn failed, when it failed for the one reason we can name.
 * `spawn … ENOENT` identifies the shell but not the missing dependency, and
 * on Windows that dependency is a whole product. Null off win32, where a
 * missing `sh` has no story worth guessing at.
 *
 * Callers append their own recovery line — the manual install command, the
 * config path to edit by hand.
 */
export function missingPosixShellHint(deps: ShellDeps = {}): string | null {
  const platform = deps.platform ?? process.platform
  if (platform !== "win32") return null
  return [
    "Rove runs POSIX shell commands through Git for Windows' bash — the same",
    "shell every engine and terminal tab launches through. Install Git for",
    "Windows (https://git-scm.com/download/win) to enable this command.",
    "",
  ].join("\n")
}
