/**
 * Which `.gitignore`d paths a salvage snapshot rescues anyway. `git add -A`
 * skips them, yet they hold real work (`HANDOFF.md`, `.scratch/**`, `.env*`,
 * `.rove/*` here). "Ignored" isn't "not the user's work"; SIZE is what
 * separates a note (KB) from `node_modules/` (hundreds of MB), so the rule is a
 * byte budget, not a filename allowlist. `status --ignored` collapses ignored
 * DIRECTORIES to one entry, so one `du -sk` per entry measures whole trees.
 */

import type { ExecHost } from "../../exec/exec-host.ts"
import { READ_ONLY_GIT_ENV } from "../../lib/git-env.ts"

/** KB, per top-level entry. 64 MB: a year of `.scratch/` markdown is
 *  single-digit MB; this repo's `node_modules/` is ~1.4 GB. */
const MAX_IGNORED_ENTRY_KB = 64 * 1024

/** Parse `git status --porcelain -z --ignored` into the `!!` (ignored) paths. */
export function parseIgnoredPaths(stdoutZ: string): string[] {
  return stdoutZ
    .split("\0")
    .filter((entry) => entry.startsWith("!! "))
    .map((entry) => entry.slice(3))
    .filter((p) => p.length > 0)
}

/** ARG_MAX is 1 MB (macOS) / ~2 MB (Linux); 96 KB is far under both and still
 *  one call for an ordinary worktree. */
const DU_ARGV_BUDGET_BYTES = 96 * 1024

/** Parse `du -sk <paths…>` output into path → kilobytes. */
export function parseDuKb(stdout: string): Map<string, number> {
  const sizes = new Map<string, number>()
  for (const line of stdout.split("\n")) {
    const m = /^(\d+)\s+(.+)$/.exec(line.trim())
    if (m?.[1] && m[2]) sizes.set(m[2], Number.parseInt(m[1], 10))
  }
  return sizes
}

/**
 * path → KB. Each of these would empty the result for the WHOLE worktree —
 * disarming the non-force delete gate (`manager-remove.ts`) and salvage's
 * `add -f`, since an unmeasured path is skipped:
 *   - `--`: a file named `-weird.log` is otherwise an option (exit 64);
 *   - chunking: past ARG_MAX the spawn fails with E2BIG;
 *   - newline in a name: `du` output is line-oriented, so those are measured
 *     one at a time, reading only the leading number.
 */
async function duKb(exec: ExecHost, worktreePath: string, paths: readonly string[]): Promise<Map<string, number>> {
  const sizes = new Map<string, number>()
  const batch: string[] = []
  let bytes = 0
  const flush = async () => {
    if (batch.length === 0) return
    const du = await exec.run(["du", "-sk", "--", ...batch], { cwd: worktreePath })
    for (const [p, kb] of parseDuKb(du.stdout)) sizes.set(p, kb)
    batch.length = 0
    bytes = 0
  }
  for (const p of paths) {
    if (p.includes("\n")) {
      const one = await exec.run(["du", "-sk", "--", p], { cwd: worktreePath })
      const kb = /^\s*(\d+)/.exec(one.stdout)?.[1]
      if (one.exitCode === 0 && kb) sizes.set(p, Number.parseInt(kb, 10))
      continue
    }
    if (bytes + p.length + 1 > DU_ARGV_BUDGET_BYTES) await flush()
    batch.push(p)
    bytes += p.length + 1
  }
  await flush()
  return sizes
}

/**
 * The small entries, or `"unknown"` when the listing didn't run. Salvage may
 * treat both as "less to snapshot", but for the non-force delete GATE an empty
 * list is permission to destroy the directory, so "could not look" must stay
 * distinct.
 */
export type IgnoredWorkProbe = readonly string[] | "unknown"

/**
 * `"unknown"` when `git status --ignored` failed. An entry whose size can't be
 * read is SKIPPED (more likely a huge tree than a note) — a per-entry verdict
 * on a successful listing, unlike `"unknown"`.
 */
export async function smallIgnoredPaths(exec: ExecHost, worktreePath: string): Promise<IgnoredWorkProbe> {
  try {
    // Lock-free: runs on the ordinary delete path, so it must not compete
    // with an engine's commit for `.git/index.lock`.
    const status = await exec.run(["git", "status", "--porcelain", "-z", "--ignored"], {
      cwd: worktreePath,
      env: READ_ONLY_GIT_ENV,
    })
    if (status.exitCode !== 0) return "unknown"
    const paths = parseIgnoredPaths(status.stdout)
    if (paths.length === 0) return []

    const sizes = await duKb(exec, worktreePath, paths)
    return paths.filter((p) => {
      const kb = sizes.get(p)
      return kb !== undefined && kb <= MAX_IGNORED_ENTRY_KB
    })
  } catch {
    return "unknown"
  }
}
