/**
 * `git` runner for the worktree manager. Invariants:
 *   - Args are an array, never a shell string: user input never reaches a
 *     shell parser.
 *   - `cwd` is explicit on every call; never `process.cwd()` (concurrent
 *     operations run in different repos).
 *   - Non-zero exit throws unless `allowFail`.
 * Node's `spawnSync`, not `Bun.spawnSync`: vitest hosts under Node where `Bun`
 * is undefined. Calls are subsecond, so sync spawn is fine.
 */

import { spawnSync } from "node:child_process"
import { READ_ONLY_GIT_ENV } from "../../lib/git-env.ts"

export interface GitRunOpts {
  /** Required — never defaulted. */
  readonly cwd: string
  /** Non-zero exit returns a result instead of throwing. */
  readonly allowFail?: boolean
  /** Merged over `process.env`. */
  readonly env?: Readonly<Record<string, string>>
  /**
   * Adds {@link READ_ONLY_GIT_ENV} (GIT_OPTIONAL_LOCKS=0) so probes never take
   * `.git/index.lock` from an engine mid-commit. ONLY for non-writing commands:
   * a writer without its lock can corrupt the index.
   */
  readonly readOnly?: boolean
}

export interface GitRunResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export class GitCommandError extends Error {
  readonly args: readonly string[]
  readonly cwd: string
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string

  constructor(args: readonly string[], cwd: string, result: GitRunResult) {
    super(
      `git ${args.join(" ")} (cwd=${cwd}) exited with code ${result.exitCode}: ${result.stderr.trim() || result.stdout.trim()}`,
    )
    this.name = "GitCommandError"
    this.args = args
    this.cwd = cwd
    this.exitCode = result.exitCode
    this.stdout = result.stdout
    this.stderr = result.stderr
  }
}

/** Throws {@link GitCommandError} on non-zero exit unless `opts.allowFail`. */
export function git(args: readonly string[], opts: GitRunOpts): GitRunResult {
  if (!opts.cwd) {
    throw new Error("git(): cwd is required; refusing to inherit from process.cwd()")
  }

  const env = { ...process.env, ...opts.env, ...(opts.readOnly ? READ_ONLY_GIT_ENV : {}) }
  const proc = spawnSync("git", [...args], {
    cwd: opts.cwd,
    env,
    encoding: "utf8",
    // Belt only; the array form is the real defense against a shell parser.
    shell: false,
  })

  const result: GitRunResult = {
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
    exitCode: proc.status ?? -1,
  }

  if (result.exitCode !== 0 && !opts.allowFail) {
    throw new GitCommandError(args, opts.cwd, result)
  }

  return result
}
