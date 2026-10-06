/**
 * Copy-on-write clone of a repo's gitignored directories (node_modules,
 * .venv, target, .build, …) from the main checkout into a fresh task
 * worktree, so the task opens with its dependencies instead of waiting on an
 * install. `.rove/init.sh` still runs afterwards and stays authoritative.
 *
 * Discovery is bounded: `git ls-files --others --ignored --directory` reports
 * an ignored directory as ONE entry without descending into it, so a
 * 100k-file `node_modules` costs a single line. A directory holding any
 * tracked file is never collapsed into one entry, so tracked paths cannot be
 * cloned by construction.
 *
 * Cloning is best-effort: every precondition miss is silent and a failure is
 * logged, never thrown, because task creation must not depend on it. `cp -c`
 * silently degrades to a full copy where clonefile(2) is unsupported, so the
 * clone is gated on darwin + same device + APFS rather than trusting cp.
 */

import fs from "node:fs/promises"
import path from "node:path"
import type { ExecHost } from "../../exec/exec-host.ts"
import { READ_ONLY_GIT_ENV } from "../../lib/git-env.ts"
import { isCloneIgnoredEnabled, resolveCloneDirs } from "../../state/worktree-clone.ts"

export interface CloneIgnoredDeps {
  readonly platform: NodeJS.Platform
  /** `st_dev` of a path; two paths clone only when this matches. */
  statDev(p: string): Promise<number>
  /** Whether the volume holding `p` is APFS (the only filesystem `cp -c` clones on). */
  isApfs(p: string): Promise<boolean>
  /** Clone `source` to the not-yet-existing `target`; rejects on failure. */
  clone(source: string, target: string): Promise<void>
  log(message: string): void
}

export function defaultCloneDeps(exec: ExecHost): CloneIgnoredDeps {
  return {
    platform: process.platform,
    statDev: async (p) => (await fs.stat(p)).dev,
    // Absolute paths: darwin only, and a PATH-shadowing coreutils `cp` has no clonefile `-c`.
    // `df -T apfs <path>` prints a row only when the path is on an APFS volume.
    isApfs: async (p) => {
      const r = await exec.run(["/bin/df", "-T", "apfs", p])
      return r.exitCode === 0 && r.stdout.trim().split("\n").length > 1
    },
    clone: async (source, target) => {
      const r = await exec.run(["/bin/cp", "-c", "-R", source, target])
      if (r.exitCode !== 0) throw new Error(r.stderr.trim() || `cp exited ${r.exitCode}`)
    },
    log: (message) => console.error(`[rove] ${message}`),
  }
}

/** Ignored directories (repo-relative, no trailing slash) whose basename is in `names`. */
async function discoverIgnoredDirs(exec: ExecHost, repo: string, names: ReadonlySet<string>): Promise<string[]> {
  const r = await exec.run(["git", "ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"], {
    cwd: repo,
    env: READ_ONLY_GIT_ENV,
  })
  if (r.exitCode !== 0) return []
  return r.stdout
    .split("\0")
    .filter((entry) => entry.endsWith("/"))
    .map((entry) => entry.slice(0, -1))
    .filter((rel) => names.has(path.posix.basename(rel)))
}

async function isRealDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.lstat(p)).isDirectory()
  } catch {
    return false
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p)
    return true
  } catch {
    return false
  }
}

/**
 * Directory names Rove clones into a new worktree on this host, empty when
 * cloning is off, unsupported or the project is remote. Doubles as "what is a
 * regenerable copy" for the delete gate.
 */
export function clonedDirNames(exec: ExecHost, worktreePath: string, deps: CloneIgnoredDeps): readonly string[] {
  if (exec.isRemote || deps.platform !== "darwin" || !isCloneIgnoredEnabled()) return []
  return resolveCloneDirs(worktreePath)
}

/**
 * Clone the configured ignored directories from `repo` into `worktreePath`.
 * Returns the repo-relative paths actually cloned; never throws.
 */
export async function cloneIgnoredDirs(
  exec: ExecHost,
  repo: string,
  worktreePath: string,
  deps: CloneIgnoredDeps = defaultCloneDeps(exec),
): Promise<readonly string[]> {
  const cloned: string[] = []
  try {
    const names = new Set(clonedDirNames(exec, worktreePath, deps))
    if (names.size === 0) return cloned

    const apfsByDev = new Map<number, boolean>()
    for (const rel of await discoverIgnoredDirs(exec, repo, names)) {
      const source = path.join(repo, rel)
      const target = path.join(worktreePath, rel)
      const targetParent = path.dirname(target)
      if (!(await isRealDirectory(source)) || (await exists(target)) || !(await isRealDirectory(targetParent))) continue

      const dev = await deps.statDev(source)
      if (dev !== (await deps.statDev(targetParent))) continue
      let apfs = apfsByDev.get(dev)
      if (apfs === undefined) {
        apfs = await deps.isApfs(source)
        apfsByDev.set(dev, apfs)
      }
      if (!apfs) continue

      try {
        await deps.clone(source, target)
        cloned.push(rel)
      } catch (err) {
        // `target` did not exist a moment ago, so whatever is there is our partial copy.
        await fs.rm(target, { recursive: true, force: true }).catch(() => {})
        deps.log(`clone of ignored dir ${rel} into ${worktreePath} failed: ${err instanceof Error ? err.message : err}`)
      }
    }
  } catch (err) {
    deps.log(`cloning ignored dirs into ${worktreePath} failed: ${err instanceof Error ? err.message : err}`)
  }
  return cloned
}
