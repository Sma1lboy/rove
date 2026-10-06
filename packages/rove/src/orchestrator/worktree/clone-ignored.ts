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
 * Each directory is ONE clonefileat(2) call (atomic: a failure leaves no
 * target), made through the perl that ships with macOS because node has no
 * binding for it and `cp -c -R` clones file by file (~10x slower).
 *
 * Cloning is best-effort: every precondition miss is silent and a failure is
 * logged, never thrown, because task creation must not depend on it.
 */

import fs from "node:fs/promises"
import path from "node:path"
import type { ExecHost } from "../../exec/exec-host.ts"
import { READ_ONLY_GIT_ENV } from "../../lib/git-env.ts"
import { DEFAULT_CLONE_DIRS, isCloneIgnoredEnabled, resolveCloneDirs } from "../../state/worktree-clone.ts"

export interface CloneIgnoredDeps {
  readonly platform: NodeJS.Platform
  /** `st_dev` of a path; two paths clone only when this matches. */
  statDev(p: string): Promise<number>
  /** Whether the volume holding `p` is APFS, the filesystem clonefile(2) works on. */
  isApfs(p: string): Promise<boolean>
  /** Clone `source` to the not-yet-existing `target`; rejects on failure. */
  clone(source: string, target: string): Promise<void>
  log(message: string): void
}

// darwin <sys/syscall.h>: SYS_clonefileat = 462.
// AT_FDCWD is -2 on darwin (Linux's -100 gives EINVAL).
const CLONEFILEAT_PERL =
  'my $r = syscall(462, -2, $ARGV[0], -2, $ARGV[1], 0); if ($r != 0) { print STDERR "clonefileat: $!\\n"; exit 1 }'

export function defaultCloneDeps(exec: ExecHost): CloneIgnoredDeps {
  return {
    platform: process.platform,
    statDev: async (p) => (await fs.stat(p)).dev,
    // Absolute paths: darwin only, and PATH may shadow these with another implementation.
    // `df -T apfs <path>` prints a row only when the path is on an APFS volume.
    isApfs: async (p) => {
      const r = await exec.run(["/bin/df", "-T", "apfs", p])
      return r.exitCode === 0 && r.stdout.trim().split("\n").length > 1
    },
    clone: async (source, target) => {
      const r = await exec.run(["/usr/bin/perl", "-e", CLONEFILEAT_PERL, source, target])
      if (r.exitCode !== 0) throw new Error(r.stderr.trim() || `perl exited ${r.exitCode}`)
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

/** Directory names to clone into a new worktree here; empty when off, unsupported or remote. */
function cloneDirNames(exec: ExecHost, worktreePath: string, deps: CloneIgnoredDeps): readonly string[] {
  if (exec.isRemote || deps.platform !== "darwin" || !isCloneIgnoredEnabled()) return []
  return resolveCloneDirs(worktreePath)
}

/**
 * Names the delete gate treats as regenerable copies rather than work: only the
 * built-in defaults that this worktree is also set to clone. A name a user adds
 * to `.rove/clone-dirs` is cloned but never becomes silently deletable.
 */
export function regenerableDirNames(exec: ExecHost, worktreePath: string, deps: CloneIgnoredDeps): readonly string[] {
  return cloneDirNames(exec, worktreePath, deps).filter((name) => DEFAULT_CLONE_DIRS.includes(name))
}

/**
 * Clone the configured ignored directories from `repo` into `worktreePath`,
 * concurrently. Returns the repo-relative paths actually cloned; never throws.
 */
export async function cloneIgnoredDirs(
  exec: ExecHost,
  repo: string,
  worktreePath: string,
  deps: CloneIgnoredDeps = defaultCloneDeps(exec),
): Promise<readonly string[]> {
  try {
    const names = new Set(cloneDirNames(exec, worktreePath, deps))
    if (names.size === 0) return []

    const apfsByDev = new Map<number, boolean>()
    const todo: { rel: string; source: string; target: string }[] = []
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
      if (apfs) todo.push({ rel, source, target })
    }

    const results = await Promise.all(
      todo.map(async ({ rel, source, target }) => {
        try {
          await deps.clone(source, target)
          return rel
        } catch (err) {
          deps.log(
            `clone of ignored dir ${rel} into ${worktreePath} failed: ${err instanceof Error ? err.message : err}`,
          )
          return null
        }
      }),
    )
    return results.filter((rel) => rel !== null)
  } catch (err) {
    deps.log(`cloning ignored dirs into ${worktreePath} failed: ${err instanceof Error ? err.message : err}`)
    return []
  }
}
