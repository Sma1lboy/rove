/**
 * A repo's `.rove/teardown.sh`: the counterpart of `init.sh`, run in a task
 * worktree right before Rove removes it (stop its containers, drop its
 * database, free what `init.sh` claimed).
 *
 * Best-effort by contract: a missing, failing or hung script never blocks the
 * removal the user already confirmed — the outcome is reported, not thrown.
 */

import type { ExecHost } from "../../exec/exec-host.ts"
import { REPO_CONFIG_DIRS } from "../../lib/repo-config-file.ts"

export const TEARDOWN_SCRIPT = "teardown.sh"
export const TEARDOWN_TIMEOUT_MS = 60_000

export type TeardownOutcome =
  | { readonly kind: "none" }
  | { readonly kind: "ok" }
  | { readonly kind: "failed"; readonly reason: string }

/** Run the worktree's own teardown script, if it ships one. Never throws. */
export async function runRepoTeardown(
  exec: ExecHost,
  worktreePath: string,
  timeoutMs: number = TEARDOWN_TIMEOUT_MS,
): Promise<TeardownOutcome> {
  let script: string | null = null
  for (const dir of REPO_CONFIG_DIRS) {
    const candidate = `${dir}/${TEARDOWN_SCRIPT}`
    if (await exec.exists(`${worktreePath}/${candidate}`).catch(() => false)) {
      script = candidate
      break
    }
  }
  if (!script) return { kind: "none" }
  const signal = AbortSignal.timeout(timeoutMs)
  try {
    const result = await exec.run(["sh", script], { cwd: worktreePath, signal })
    if (signal.aborted) return { kind: "failed", reason: `timed out after ${Math.round(timeoutMs / 1000)}s` }
    if (result.exitCode === 0) return { kind: "ok" }
    const detail = (result.stderr.trim() || result.stdout.trim()).split("\n").slice(-3).join(" | ")
    return { kind: "failed", reason: `exit ${result.exitCode}${detail ? `: ${detail}` : ""}` }
  } catch (err) {
    if (signal.aborted) return { kind: "failed", reason: `timed out after ${Math.round(timeoutMs / 1000)}s` }
    return { kind: "failed", reason: err instanceof Error ? err.message : String(err) }
  }
}
