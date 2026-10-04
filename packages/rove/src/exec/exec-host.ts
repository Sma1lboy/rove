/**
 * ExecHost — the local/remote execution seam. Everything on the "worktree
 * side" (git, fs reads, the engine launch) goes through it, so a REMOTE project
 * runs the same logic over SSH:
 *
 *   - LocalExecHost  — async `spawn` + node `fs` (the default).
 *   - RemoteExecHost — wraps every command in `ssh … 'cd <cwd> && <cmd>'`,
 *     reusing ONE multiplexed connection per remote project (ControlMaster).
 *
 * See `docs/design/remote-projects.md`.
 *
 * Blocking discipline: the DAEMON runs worktree git through this seam, and a
 * `git worktree add` on a big repo takes minutes while every TUI client's RPCs
 * stall behind a blocked event loop. So `run` / `exists` / `mkdirp` /
 * `readFile` / `readdir` are ASYNC; `isRemote` and `wrapCommand` (pure string
 * building) are sync.
 *
 * `ensureReady()` stays sync (called from TUI engine launch and from
 * `RemoteExecHost.run`'s first call) — the one remaining sync ssh on the daemon
 * path. `exec/resolve.ts` caches ONE host per `controlPath`, so the sync
 * `-O check` pays once per master lifetime; the `exitCode === 255` reset in
 * `run()` re-arms it when a ControlPersist socket drops.
 *
 * Security (non-negotiable, see the design doc):
 *   - The password is NEVER in the command string, in `state.json`, or in
 *     `ps`/argv. It is read from the OS keychain into the `SSHPASS` env and
 *     used by `sshpass -e` ONLY to bring up the ControlMaster master once;
 *     every later call reuses the multiplexed socket with no auth, so the
 *     engine-launch ssh (which lands in the tmux pane command) carries no
 *     secret.
 *   - First connect uses `StrictHostKeyChecking=accept-new` (TOFU — accept
 *     unknown, reject a CHANGED key), never `no`.
 */

import { spawn, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, readFile as readFileAsync, readdir as readdirAsync } from "node:fs/promises"
import { quoteShellArg, quoteShellArgv } from "../lib/shell-command"

/** SSH auth: a key (or the agent) vs a password held in the OS keychain. */
export type RemoteAuth =
  | { readonly kind: "key"; readonly keyPath?: string } // keyPath absent → ssh-agent / default identities
  | { readonly kind: "password"; readonly getPassword: () => string | null } // secret fetched lazily from keychain

/** Everything RemoteExecHost needs to reach a host (no persisted secret). */
export interface RemoteSpec {
  readonly host: string
  readonly user: string
  readonly port?: number
  readonly auth: RemoteAuth
  /** ControlMaster socket path (one per remote project, under the Rove home). */
  readonly controlPath: string
}

export interface ExecResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export interface ExecOpts {
  /** Working directory the command runs in (a LOCAL path locally, a REMOTE path remotely). */
  readonly cwd?: string
  /** Extra environment for the command. Local merges it into process env; remote prefixes safe keys into the shell command. */
  readonly env?: Readonly<Record<string, string>>
  /** Optional cancellation signal. Local and remote async subprocesses receive it. */
  readonly signal?: AbortSignal
}

/** `run` matches `orchestrator/worktree/git.ts`'s result shape so the worktree
 *  manager routes through it unchanged. Sync/async split: see file header. */
export interface ExecHost {
  readonly isRemote: boolean
  run(argv: readonly string[], opts?: ExecOpts): Promise<ExecResult>
  exists(path: string): Promise<boolean>
  /** `mkdir -p`. */
  mkdirp(path: string): Promise<void>
  /** utf8 contents, or null when unreadable. */
  readFile(path: string): Promise<string | null>
  /** Directory entries (empty on failure). */
  readdir(path: string): Promise<string[]>
  /**
   * Wrap a command STRING to run on the host (the tmux pane command). Local →
   * as-is; remote → `ssh -tt … '<cd cwd && cmd>'` over the control socket, no
   * secret in the string. Remote callers must `ensureReady()` first.
   */
  wrapCommand(command: string, opts?: { readonly tty?: boolean; readonly cwd?: string }): string
  /** No-op locally; opens the ControlMaster remotely (sync — see file header). */
  ensureReady(): void
}

// ── pure shell / ssh construction (exported for tests) ───────────────────────

export const shQuote = quoteShellArg

export const shJoin = quoteShellArgv

/** Quote only tokens unsafe as a bare shell word, so flags / `user@host` stay readable. */
function shToken(s: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : quoteShellArg(s)
}

/** `cd <cwd> && <command>`. Takes a STRING because `wrapCommand` never has the argv. */
export function remoteShellCommand(command: string, cwd?: string): string {
  return cwd ? `cd ${shQuote(cwd)} && ${command}` : command
}

function remoteEnvPrefix(env: Readonly<Record<string, string>> | undefined): string {
  if (!env) return ""
  const pairs = Object.entries(env).filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
  if (pairs.length === 0) return ""
  return `${pairs.map(([key, value]) => `${key}=${shQuote(value)}`).join(" ")} `
}

/** `ssh` argv up to `user@host` (no remote command, no sshpass). `batch` makes a
 *  non-interactive call fail fast instead of prompting. */
export function sshConnectArgs(spec: RemoteSpec, opts: { tty?: boolean; batch?: boolean } = {}): string[] {
  const argv = ["ssh"]
  if (opts.tty) argv.push("-tt")
  if (opts.batch) argv.push("-o", "BatchMode=yes")
  // Reuse one multiplexed connection per remote project (the perf keystone).
  argv.push("-o", "ControlMaster=auto", "-o", `ControlPath=${spec.controlPath}`, "-o", "ControlPersist=300")
  // TOFU: accept an unknown host key on first connect, reject a CHANGED one.
  argv.push("-o", "StrictHostKeyChecking=accept-new")
  if (spec.port) argv.push("-p", String(spec.port))
  if (spec.auth.kind === "key" && spec.auth.keyPath) argv.push("-i", spec.auth.keyPath)
  argv.push(`${spec.user}@${spec.host}`)
  return argv
}

/** Async spawn with `spawnSync`'s result contract: never rejects; spawn failure
 *  (ENOENT, bad cwd) → exitCode -1. */
function spawnCollect(
  argv: readonly string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal } = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const [cmd, ...rest] = argv
    let stdout = ""
    let stderr = ""
    let settled = false
    const finish = (exitCode: number) => {
      if (settled) return
      settled = true
      resolve({ stdout, stderr, exitCode })
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(cmd ?? "", rest, {
        cwd: opts.cwd,
        env: opts.env,
        shell: false,
        signal: opts.signal,
      })
    } catch {
      finish(-1)
      return
    }
    child.stdout?.setEncoding("utf8")
    child.stdout?.on("data", (d: string) => {
      stdout += d
    })
    child.stderr?.setEncoding("utf8")
    child.stderr?.on("data", (d: string) => {
      stderr += d
    })
    child.on("error", () => finish(-1))
    child.on("close", (code) => finish(code ?? -1))
  })
}

// ── Local ────────────────────────────────────────────────────────────────────

export class LocalExecHost implements ExecHost {
  readonly isRemote = false

  run(argv: readonly string[], opts: ExecOpts = {}): Promise<ExecResult> {
    return spawnCollect(argv, {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      signal: opts.signal,
    })
  }

  async exists(path: string): Promise<boolean> {
    return existsSync(path)
  }
  async mkdirp(path: string): Promise<void> {
    await mkdir(path, { recursive: true })
  }
  async readFile(path: string): Promise<string | null> {
    try {
      return await readFileAsync(path, "utf8")
    } catch {
      return null
    }
  }
  async readdir(path: string): Promise<string[]> {
    try {
      return await readdirAsync(path)
    } catch {
      return []
    }
  }
  wrapCommand(command: string): string {
    return command
  }
  ensureReady(): void {}
}

// ── Remote ─────────────────────────────────────────────────────────────────

/** Sync spawn seam (tests assert the ssh argv); used by `ensureReady`. */
export type Spawner = (argv: readonly string[], env?: Record<string, string>) => ExecResult

/** ASYNC spawn seam — used by `run` (and everything built on it). */
export type AsyncSpawner = (
  argv: readonly string[],
  env?: Record<string, string>,
  opts?: { signal?: AbortSignal },
) => Promise<ExecResult>

const defaultSpawner: Spawner = (argv, env) => {
  const [cmd, ...rest] = argv
  const proc = spawnSync(cmd ?? "", rest, {
    env: env ? { ...process.env, ...env } : process.env,
    encoding: "utf8",
    shell: false,
  })
  return { stdout: proc.stdout ?? "", stderr: proc.stderr ?? "", exitCode: proc.status ?? -1 }
}

const defaultAsyncSpawner: AsyncSpawner = (argv, env, opts) =>
  spawnCollect(argv, {
    env: env ? { ...process.env, ...env } : process.env,
    signal: opts?.signal,
  })

/** `ensureReady` opens the control socket once; the keychain password feeds
 *  sshpass exactly then and never reaches a later command. */
export class RemoteExecHost implements ExecHost {
  readonly isRemote = true
  private masterUp = false
  private readonly spawnAsync: AsyncSpawner

  constructor(
    private readonly spec: RemoteSpec,
    private readonly spawn: Spawner = defaultSpawner,
    spawnAsync?: AsyncSpawner,
  ) {
    // An injected sync fake also serves async calls, so it observes every call.
    this.spawnAsync =
      spawnAsync ?? (this.spawn === defaultSpawner ? defaultAsyncSpawner : async (argv, env) => this.spawn(argv, env))
  }

  /** Open the ControlMaster master once. Idempotent: a live socket is reused. */
  ensureReady(): void {
    if (this.masterUp) return
    // `-O check` succeeds (exit 0) when the master socket is already alive.
    const check = this.spawn([...sshConnectArgs(this.spec, { batch: true }), "-O", "check"])
    if (check.exitCode === 0) {
      this.masterUp = true
      return
    }
    // Bring up a backgrounded master (-fN). Password auth feeds sshpass via
    // SSHPASS env (NEVER -p, which leaks on argv); key/agent needs no prefix.
    const base = [...sshConnectArgs(this.spec, { batch: this.spec.auth.kind !== "password" }), "-fN"]
    if (this.spec.auth.kind === "password") {
      const pw = this.spec.auth.getPassword()
      if (pw != null) {
        this.spawn(["sshpass", "-e", ...base], { SSHPASS: pw })
        this.masterUp = true
        return
      }
    }
    this.spawn(base)
    this.masterUp = true
  }

  async run(argv: readonly string[], opts: ExecOpts = {}): Promise<ExecResult> {
    this.ensureReady()
    // No sshpass: the master carries the channel with no re-auth.
    const remote = remoteShellCommand(`${remoteEnvPrefix(opts.env)}${shJoin(argv)}`, opts.cwd)
    const result = await this.spawnAsync([...sshConnectArgs(this.spec, { batch: true }), remote], undefined, {
      signal: opts.signal,
    })
    // 255 is ssh's own failure code (0-254 pass through from the far side),
    // e.g. a stale ControlPersist socket. Reset so the cached host instance
    // (`exec/resolve.ts`) re-runs `ensureReady()` instead of staying wrong.
    if (result.exitCode === 255) this.masterUp = false
    return result
  }

  async exists(path: string): Promise<boolean> {
    return (await this.run(["test", "-e", path])).exitCode === 0
  }
  async mkdirp(path: string): Promise<void> {
    await this.run(["mkdir", "-p", path])
  }
  async readFile(path: string): Promise<string | null> {
    const r = await this.run(["cat", path])
    return r.exitCode === 0 ? r.stdout : null
  }
  async readdir(path: string): Promise<string[]> {
    const r = await this.run(["ls", "-1A", path])
    if (r.exitCode !== 0) return []
    return r.stdout.split("\n").filter((s) => s.length > 0)
  }

  wrapCommand(command: string, opts: { tty?: boolean; cwd?: string } = {}): string {
    // Parsed by the LOCAL shell tmux runs the pane in; the remote command is
    // single-quoted so ssh gets it as one arg. No sshpass → no secret.
    const remote = remoteShellCommand(command, opts.cwd)
    // Only this string-join path goes through a shell, and ControlPath / `-i`
    // keyPath can contain spaces or metachars.
    const connect = sshConnectArgs(this.spec, { tty: opts.tty }).map(shToken).join(" ")
    return `${connect} ${shQuote(remote)}`
  }
}
