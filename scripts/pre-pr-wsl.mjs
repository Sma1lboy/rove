// pre-pr's Windows half: the POSIX suites (unit, behavior, render, visual,
// package tests) assume symlinks, file modes and bash, so on Windows they run
// in a WSL distro, against a copy of the commit in the Linux filesystem.

import { spawnSync } from "node:child_process"

/** `wsl.exe -l -q` prints UTF-16LE; Docker Desktop's own distros cannot run the suites. */
export function pickDistro(listOutput, override) {
  if (override) return override
  const names = listOutput
    .replace(/\0/g, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  return names.find((n) => !n.startsWith("docker-desktop")) ?? null
}

export function wslDistro() {
  const r = spawnSync("wsl.exe", ["-l", "-q"], { encoding: "utf16le" })
  if (r.status !== 0 || r.error) return null
  return pickDistro(r.stdout, process.env.ROVE_WSL_DISTRO)
}

/** `C:\Users\x` or `C:/Users/x` → `/mnt/c/Users/x`. */
export function toWslPath(winPath) {
  const m = winPath.replace(/\\/g, "/").match(/^([A-Za-z]):\/?(.*)$/)
  if (!m) throw new Error(`not a drive path: ${winPath}`)
  return `/mnt/${m[1].toLowerCase()}/${m[2]}`.replace(/\/$/, "")
}

/**
 * One shell line for `bash -lc`: fetch `ref` from the shared git dir into a
 * per-worktree clone under ~/.cache, check it out, install, and run the suites.
 * A worktree's own `.git` file holds a Windows path Linux git cannot follow,
 * hence the ref in the common dir. No double quotes: wsl.exe re-quotes argv.
 */
export function wslScript({ name, gitDir, ref, touchedFile, jobs, full = false }) {
  const repo = `$HOME/.cache/rove-pre-pr/${name}`
  return [
    "set -e",
    `mkdir -p ${repo}`,
    `cd ${repo}`,
    "[ -d .git ] || git init -q",
    `git fetch --quiet --no-tags ${toWslPath(gitDir)} +${ref}:refs/remotes/win/head`,
    "git checkout --quiet --force --detach refs/remotes/win/head",
    "git clean -fdq",
    "bun install --frozen-lockfile",
    `node scripts/pre-pr.mjs --suites-only --touched-file ${toWslPath(touchedFile)} --jobs ${jobs}${full ? " --full" : ""}`,
  ].join("; ")
}
