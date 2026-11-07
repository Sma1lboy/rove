/**
 * The `gh auth login --web` device flow as a child this process owns. The code and URL it prints
 * are what the owner types into github.com; the child keeps polling until they do, then `gh`
 * stores the token in its own credential store. One flow per machine at a time.
 */

import { type ChildProcess, spawn } from "node:child_process"
import { ApiError } from "../cli/api/types.ts"
import { GH_ENV, GITHUB_HOST } from "./run-tool.ts"

export interface LoginState {
  /** `pending`: waiting for the code to be entered. `syncing`: signed in, finishing up (git setup, other machines). */
  readonly state: "pending" | "syncing" | "failed"
  readonly code?: string
  readonly url?: string
  readonly error?: string
}

export type LoginProcess = Pick<ChildProcess, "stdout" | "stderr" | "on" | "kill">

const CODE_WAIT_MS = 15_000
const OUTPUT_CAP = 8_000

export function parseDeviceOutput(text: string): { code?: string; url?: string } {
  const code = /one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i.exec(text)?.[1]
  const url = /(https:\/\/\S+\/login\/device)/.exec(text)?.[1]
  return { ...(code ? { code } : {}), ...(url ? { url } : {}) }
}

/** gh's last word on why the flow ended, minus the instructions it printed first. */
function failureText(output: string): string {
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/one-time code|Open this URL|Press Enter/i.test(l))
  return (lines[lines.length - 1] ?? "gh exited without signing in").slice(0, 300)
}

export function spawnGhLogin(): LoginProcess {
  return spawn("gh", ["auth", "login", "--web", "--hostname", GITHUB_HOST, "--skip-ssh-key"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...GH_ENV, NO_COLOR: "1" },
  })
}

/** Flows with a live `gh` child, so the daemon's graceful stop can end them: a child keeps its event loop alive. */
const running = new Set<DeviceLogin>()

export function cancelAllLogins(): void {
  for (const login of running) login.cancel()
}

export class DeviceLogin {
  private child: LoginProcess | null = null
  private current: LoginState | null = null
  private pending: Promise<LoginState> | null = null
  private syncOthers = false
  /** The daemon exiting must not leave `gh` polling for a code nobody can read any more. */
  private readonly killChild = (): void => {
    this.child?.kill()
  }

  private hold(): void {
    running.add(this)
    process.once("exit", this.killChild)
  }

  private release(): void {
    running.delete(this)
    process.off("exit", this.killChild)
  }

  constructor(
    private readonly deps: {
      readonly spawn: () => LoginProcess
      /** After `gh` stored the token: git setup and whatever else follows a sign-in. Failures stay inside it. */
      readonly finish: (syncOthers: boolean) => Promise<void>
      readonly codeWaitMs?: number
    },
  ) {}

  state(): LoginState | null {
    return this.current
  }

  /**
   * Start the flow, or return the one already running. Resolves once the code and URL are known.
   * `syncOthers`: once signed in, also bring the other machines that are signed out along.
   */
  start(syncOthers: boolean): Promise<LoginState> {
    const live = this.current
    if (live && (live.state === "syncing" || (live.state === "pending" && live.code))) return Promise.resolve(live)
    if (this.pending) return this.pending
    this.current = { state: "pending" }
    this.syncOthers = syncOthers
    this.pending = this.run().finally(() => {
      this.pending = null
    })
    return this.pending
  }

  /** Stop a running flow or dismiss a failed one; false when there was nothing to stop. */
  cancel(): boolean {
    const had = this.child !== null || this.current !== null
    const child = this.child
    this.child = null
    this.current = null
    this.release()
    child?.kill()
    return had
  }

  private run(): Promise<LoginState> {
    return new Promise<LoginState>((resolve, reject) => {
      const child = this.deps.spawn()
      this.child = child
      this.hold()
      let output = ""
      let shown = false
      const fail = (error: string): void => {
        if (this.child !== child) return
        this.child = null
        this.release()
        this.current = { state: "failed", error }
        if (!shown) reject(new ApiError(`GitHub sign-in did not start: ${error}`, "GITHUB_LOGIN_FAILED"))
      }
      const timer = setTimeout(() => {
        if (shown || this.child !== child) return
        child.kill()
        fail(`gh printed no device code within ${(this.deps.codeWaitMs ?? CODE_WAIT_MS) / 1000}s`)
      }, this.deps.codeWaitMs ?? CODE_WAIT_MS)
      const onData = (chunk: Buffer): void => {
        if (this.child !== child) return
        if (output.length < OUTPUT_CAP) output += chunk.toString("utf8")
        if (shown) return
        const { code, url } = parseDeviceOutput(output)
        if (!code || !url) return
        shown = true
        clearTimeout(timer)
        this.current = { state: "pending", code, url }
        resolve(this.current)
      }
      child.stdout?.on("data", onData)
      child.stderr?.on("data", onData)
      child.on("error", (err: NodeJS.ErrnoException) => {
        clearTimeout(timer)
        fail(err.code === "ENOENT" ? "gh is not installed" : err.message)
      })
      child.on("close", (code) => {
        clearTimeout(timer)
        if (this.child !== child) {
          if (!shown) reject(new ApiError("GitHub sign-in was cancelled", "GITHUB_LOGIN_CANCELLED"))
          return
        }
        if (code !== 0) return fail(failureText(output))
        this.child = null
        this.release()
        this.current = { state: "syncing" }
        void this.deps
          .finish(this.syncOthers)
          .catch(() => {})
          .then(() => {
            if (this.current?.state === "syncing") this.current = null
          })
      })
    })
  }
}
