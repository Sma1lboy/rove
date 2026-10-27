/**
 * Run `git` / `gh` / `ssh` and report what happened as a value. A missing tool and a timeout are
 * results, not throws: the GitHub verbs describe a machine that may have none of them.
 */

import { spawn } from "node:child_process"

export interface ToolResult {
  /** Exit code; null when the process was killed (timeout) or never started. */
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  /** The executable is not installed (or not on PATH). */
  readonly missing: boolean
  readonly timedOut: boolean
}

export interface RunToolOptions {
  readonly timeoutMs: number
  /** Written to the child's stdin, then closed. Secrets travel here, never in argv. */
  readonly input?: string
  readonly env?: NodeJS.ProcessEnv
}

export type RunTool = (cmd: string, args: readonly string[], opts: RunToolOptions) => Promise<ToolResult>

export const GITHUB_HOST = "github.com"

/** `gh` never prompts and never nags about updates. */
export const GH_ENV: NodeJS.ProcessEnv = { GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1" }

const OUTPUT_CAP = 1_000_000

export const runTool: RunTool = (cmd, args, opts) =>
  new Promise<ToolResult>((resolve) => {
    let stdout = ""
    let stderr = ""
    let timedOut = false
    let settled = false
    const done = (result: Omit<ToolResult, "stdout" | "stderr" | "timedOut">): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ...result, stdout, stderr, timedOut })
    }
    const child = spawn(cmd, [...args], {
      stdio: [opts.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1", ...opts.env },
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, opts.timeoutMs)
    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < OUTPUT_CAP) stdout += chunk.toString("utf8")
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < OUTPUT_CAP) stderr += chunk.toString("utf8")
    })
    child.on("error", (err: NodeJS.ErrnoException) => done({ code: null, missing: err.code === "ENOENT" }))
    child.on("close", (code) => done({ code, missing: false }))
    if (opts.input !== undefined && child.stdin) {
      child.stdin.on("error", () => {})
      child.stdin.end(opts.input)
    }
  })
