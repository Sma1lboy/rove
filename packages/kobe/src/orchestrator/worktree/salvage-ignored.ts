/**
 * Which `.gitignore`d paths a salvage snapshot should rescue anyway.
 *
 * `git add -A` honours `.gitignore`, which keeps `node_modules/` and build
 * output out of the snapshot — and also throws away real work. In this repo
 * alone, `.gitignore` covers `HANDOFF.md` and `.scratch/**`, the two places
 * AGENTS.md tells agents to keep cross-session reasoning, plus `.env*` and
 * `.rove/*`. Force-deleting a worktree destroyed all of them while the salvage
 * ref reported success.
 *
 * "Ignored" answers "should git track this", not "is this the user's work".
 * The distinction that actually matters is SIZE: a hand-written note is
 * kilobytes, a dependency tree or build output is hundreds of megabytes, and
 * a snapshot that swallows `node_modules/` is one nobody can use. So the rule
 * is a byte budget rather than a filename list — no allowlist to maintain, and
 * an ignored path this repo has never heard of is rescued on the same terms.
 *
 * `git status --porcelain --ignored` reports ignored DIRECTORIES collapsed to
 * one entry (`node_modules/`) and ignored FILES individually (`HANDOFF.md`),
 * so one `du -sk` per entry measures whole trees without walking them here.
 */

import type { ExecHost } from "../../exec/exec-host.ts"
import { READ_ONLY_GIT_ENV } from "../../lib/git-env.ts"

/**
 * Per-entry size ceiling, in kilobytes. 64 MB: comfortably above any plausible
 * hand-authored file or notes directory (`.scratch/` with a year of markdown
 * is single-digit MB), comfortably below a dependency tree or build output
 * (`node_modules/` in this repo is ~1.4 GB). Applied per top-level entry, so
 * one oversized tree is skipped without costing the others.
 */
const MAX_IGNORED_ENTRY_KB = 64 * 1024

/** Parse `git status --porcelain -z --ignored` into the `!!` (ignored) paths. */
export function parseIgnoredPaths(stdoutZ: string): string[] {
  return stdoutZ
    .split("\0")
    .filter((entry) => entry.startsWith("!! "))
    .map((entry) => entry.slice(3))
    .filter((p) => p.length > 0)
}

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
 * The ignored paths in `worktreePath` small enough to be worth snapshotting.
 *
 * Returns `[]` on any failure — salvage must degrade to its old
 * ignored-files-excluded behaviour rather than fail the removal a caller
 * already asked for. An entry whose size cannot be read is SKIPPED, not
 * guessed at: an unmeasurable path is more likely a huge tree than a note,
 * and a snapshot that swallows one is worse than one that misses it.
 */
export async function smallIgnoredPaths(exec: ExecHost, worktreePath: string): Promise<string[]> {
  try {
    // Lock-free, like every other status probe (`lib/git-env.ts`): this now
    // runs on the ORDINARY delete path, not just the force one, so it must not
    // compete with an engine's `git commit` for `.git/index.lock`.
    const status = await exec.run(["git", "status", "--porcelain", "-z", "--ignored"], {
      cwd: worktreePath,
      env: READ_ONLY_GIT_ENV,
    })
    if (status.exitCode !== 0) return []
    const paths = parseIgnoredPaths(status.stdout)
    if (paths.length === 0) return []

    // One `du` for every entry: each ignored directory is reported collapsed,
    // so this is a handful of arguments, not a walk of the whole tree.
    const du = await exec.run(["du", "-sk", ...paths], { cwd: worktreePath })
    const sizes = parseDuKb(du.stdout)
    return paths.filter((p) => {
      const kb = sizes.get(p)
      return kb !== undefined && kb <= MAX_IGNORED_ENTRY_KB
    })
  } catch {
    return []
  }
}
