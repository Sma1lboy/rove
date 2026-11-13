import { execFile } from "node:child_process"

export interface RunResult {
  readonly ok: boolean
  readonly stdout: string
  readonly stderr: string
  /** Set when the command never ran or was cut off (spawn failure, timeout). */
  readonly error?: string
}

/**
 * Run a command off the event loop. Verbs run inside the daemon: a sync spawn there answers no
 * request until it returns, which another machine reads as a dead daemon. Never throws.
 */
export function runAsync(
  cmd: string,
  args: readonly string[],
  opts: { readonly cwd?: string; readonly timeoutMs?: number; readonly env?: NodeJS.ProcessEnv } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      [...args],
      { cwd: opts.cwd, env: opts.env, timeout: opts.timeoutMs, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        // A command that exits non-zero has a numeric code; anything else never finished.
        const ran = !err || typeof err.code === "number"
        resolve({ ok: !err, stdout: stdout ?? "", stderr: stderr ?? "", ...(ran ? {} : { error: err.message }) })
      },
    )
  })
}
