/**
 * Experimental `layerfs` backend (Linux Runners): a task's files are a LayerFS Workspace, FUSE-mounted inside a
 * per-task Sandbox container and bind-mounted there at the task's own host path, so the engine's cwd equals
 * `worktreePath`. The host directory holds only this backend's state file and the PTY launch prefix
 * (`docker exec` into that path). Setup and limits: docs/design/workspace-runner.md, "LayerFS backend".
 */

import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { promises as fs, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import type { CheckpointRecord, TakeCheckpointResult } from "@sma1lboy/rove-daemon/daemon/checkpoint-contracts"
import { LAUNCH_PREFIX_FILE } from "@sma1lboy/rove-daemon/daemon/pty-host-types"
import { WORKSPACE_CAPABILITIES } from "@sma1lboy/rove-daemon/workspace"
import { getPersistedString } from "../../state/repos.ts"
import { worktreePathFor } from "../worktree/paths.ts"
import type {
  DisposeTarget,
  MaterializeSpec,
  WorkspaceBackend,
  WorkspaceCheckpointer,
  WorkspaceHandle,
} from "./types.ts"

export const LAYERFS_CONFIG_KEY = "experimental.layerfs"
const STATE_FILE = ".rove-layerfs.json"
/** The LayerFS daemon runs every Workspace command as this user (`api/binding/src/sandbox.rs`). */
const SANDBOX_USER = "501:20"
const SANDBOX_HOME = "/tmp/rove-home"
/** `sh -c` bodies run as the sandbox user (container root cannot read another uid's /proc without CAP_SYS_PTRACE): kill every process whose env carries `$1` / whose cwd is under `$1`. */
const KILL_TAGGED = `for p in /proc/[0-9]*; do tr '\\0' '\\n' < $p/environ 2>/dev/null | grep -qx "$1" && kill -KILL \${p#/proc/}; done; true`
const KILL_UNDER = `for p in /proc/[0-9]*; do case $(readlink $p/cwd) in "$1"|"$1"/*) kill -KILL \${p#/proc/};; esac; done; sleep 0.2`

/** Runs one command; rejects with its stderr/stdout on a non-zero exit. Injected by tests. */
export type Run = (file: string, args: readonly string[]) => Promise<string>

const execRun: Run = async (file, args) => {
  try {
    const { stdout } = await promisify(execFile)(file, [...args], { maxBuffer: 64 * 1024 * 1024 })
    return stdout
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message: string }
    throw new Error((e.stderr?.trim() || e.stdout?.trim() || e.message).slice(0, 2000))
  }
}

/** `KEY=VALUE` lines (optional `export `, `#` comments); LAYERFS_CLI and LAYERFS_NODE name the CLI and its node. */
export function parseLayerfsEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line)
    if (m) env[m[1] as string] = (m[2] as string).trim().replace(/^(["'])(.*)\1$/, "$2")
  }
  return env
}

interface LayerfsState {
  project: string
  sandbox: string
  /** `<sandbox>:/workspaces/N`, the mounted Workspace. */
  ws: string
  container: string
  /** LayerFS Branch the mount is on; a rewind moves it to a fork. */
  branch: string
  /** Commit the task's git branch was cut from; the export bundle starts after it. */
  gitBase: string
  checkpoints: CheckpointRecord[]
}

export interface LayerfsDeps {
  readonly run?: Run
  /** The env file path; default `experimental.layerfs` in state.json. */
  readonly configPath?: () => string | undefined
  readonly platform?: NodeJS.Platform
}

export class LayerfsBackend implements WorkspaceBackend {
  readonly id = "layerfs"
  readonly capabilities = WORKSPACE_CAPABILITIES.layerfs
  private readonly run: Run
  private readonly configPath: () => string | undefined
  private readonly platform: NodeJS.Platform
  private rootChecked = false

  constructor(deps: LayerfsDeps = {}) {
    this.run = deps.run ?? execRun
    this.configPath = deps.configPath ?? (() => getPersistedString(LAYERFS_CONFIG_KEY))
    this.platform = deps.platform ?? process.platform
  }

  async preflight(): Promise<void> {
    this.env()
    await this.requireRoot()
  }

  /** The configured LayerFS settings, or a `LAYERFS_UNAVAILABLE:` refusal. */
  private env(): Record<string, string> {
    if (this.platform !== "linux") throw unavailable(`it runs on Linux Runners only, not ${this.platform}`)
    const file = this.configPath()
    if (!file) throw unavailable(`set ${LAYERFS_CONFIG_KEY} in state.json to a LayerFS env file`)
    let env: Record<string, string>
    try {
      env = parseLayerfsEnv(readFileSync(file, "utf8"))
    } catch (err) {
      throw unavailable(`cannot read ${file}: ${(err as Error).message}`)
    }
    for (const key of ["LAYERFS_CLI", "LAYERFS_NODE", "LAYERFS_HOME", "LAYERFS_STORE_PATH", "LAYERFS_IMAGE"]) {
      if (!env[key]) throw unavailable(`${file} does not set ${key}`)
    }
    return env
  }

  /** The Store sits under root-only `/var/lib/docker`: every LayerFS call goes through `sudo -n`, never a prompt. */
  private async requireRoot(): Promise<void> {
    if (this.rootChecked) return
    try {
      await this.run("sudo", ["-n", "true"])
    } catch {
      throw new Error(
        "LAYERFS_NEEDS_ROOT: LayerFS Store calls run as root, and `sudo -n` cannot (configure passwordless sudo for this user)",
      )
    }
    this.rootChecked = true
  }

  /** One LayerFS CLI call as root, its JSON reply parsed. The only privileged step this backend takes. */
  private async lfs(project: string, ...args: string[]): Promise<Record<string, unknown>> {
    const env = this.env()
    await this.requireRoot()
    const pass = Object.entries(env)
      .filter(([k]) => k !== "LAYERFS_CLI" && k !== "LAYERFS_NODE")
      .map(([k, v]) => `${k}=${v}`)
    const out = await this.run("sudo", [
      "-n",
      "env",
      ...pass,
      `LAYERFS_PROJECT=${project}`,
      env.LAYERFS_NODE as string,
      env.LAYERFS_CLI as string,
      ...args,
    ])
    return JSON.parse(out) as Record<string, unknown>
  }

  private docker(...args: string[]): Promise<string> {
    return this.run("docker", args)
  }

  private inSandbox(s: Pick<LayerfsState, "container">, dir: string, ...argv: string[]): Promise<string> {
    return this.docker("exec", "-u", SANDBOX_USER, "-w", dir, "-e", `HOME=${SANDBOX_HOME}`, s.container, ...argv)
  }

  /** One project per repo, imported once from the repo's checkout (`.git` included, like everything else). */
  private async ensureProject(repo: string): Promise<string> {
    const project = `rove-${createHash("sha1").update(repo).digest("hex").slice(0, 12)}`
    try {
      await this.lfs(project, "project", "list_branches", "--page-size", "1")
    } catch {
      // ponytail: the import is the repo as it is now; a task whose baseRef is newer than it fails at checkout.
      await this.lfs(project, "init", project, repo, "--timeout", "1800000")
    }
    return project
  }

  async materialize(spec: MaterializeSpec): Promise<WorkspaceHandle> {
    if (spec.forkFrom || spec.path) throw unavailable("a layerfs task cannot be forked or borrow a directory")
    this.env()
    const dir = worktreePathFor(spec.repo, spec.slug)
    const project = await this.ensureProject(spec.repo)
    // LayerFS Branches outlive their task (no delete call), so a reused slug needs a fresh name.
    const branch = `${spec.slug}-${Date.now().toString(36)}`
    await this.lfs(project, "branch", "fork", branch)
    const { sandbox } = (await this.lfs(project, "sandbox", "create")) as { sandbox: string }
    const s: LayerfsState = { project, sandbox, ws: "", container: "", branch, gitBase: "", checkpoints: [] }
    try {
      s.container = await this.containerOf(project, sandbox)
      await this.mount(s, dir)
      await this.inSandbox(s, dir, "git", "checkout", "-q", "-b", spec.branch, ...(spec.baseRef ? [spec.baseRef] : []))
      s.gitBase = (await this.inSandbox(s, dir, "git", "rev-parse", "HEAD")).trim()
      const reap = [
        "docker",
        "exec",
        "-u",
        SANDBOX_USER,
        s.container,
        "sh",
        "-c",
        KILL_TAGGED,
        "sh",
        "ROVE_LAUNCH={launch}",
      ]
      await fs.writeFile(
        path.join(dir, LAUNCH_PREFIX_FILE),
        JSON.stringify({ prefix: this.launchPrefix(s, dir), reap }),
      )
      await this.save(dir, s)
    } catch (err) {
      await this.teardown(s, dir, true).catch(() => {})
      throw err
    }
    return { backend: this.id, path: dir, ref: `${project}:${branch}` }
  }

  private launchPrefix(s: LayerfsState, dir: string): string[] {
    // Bare `-e NAME` forwards the PTY host's value: the size and TERM it set for this child.
    const env = [
      "-e",
      `HOME=${SANDBOX_HOME}`,
      "-e",
      "ROVE_LAUNCH={launch}",
      "-e",
      "TERM",
      "-e",
      "COLUMNS",
      "-e",
      "LINES",
    ]
    return ["docker", "exec", "-it", "-u", SANDBOX_USER, "-w", dir, ...env, s.container]
  }

  private async containerOf(project: string, sandbox: string): Promise<string> {
    const id = (
      await this.docker(
        "ps",
        "-q",
        "--filter",
        `label=layerfs.project=${project}`,
        "--filter",
        `label=layerfs.sandbox=${sandbox}`,
      )
    ).trim()
    if (!id || id.includes("\n")) throw new Error(`no single container for LayerFS sandbox ${project}/${sandbox}`)
    return id
  }

  /** Mount `s.branch` and bind it at `dir` inside the container, where the engine runs. */
  private async mount(s: LayerfsState, dir: string): Promise<void> {
    s.ws = ((await this.lfs(s.project, "workspace", "mount", s.sandbox, s.branch)) as { ws: string }).ws
    await fs.mkdir(dir, { recursive: true })
    await this.bind(s, dir)
  }

  private async bind(s: LayerfsState, dir: string): Promise<void> {
    const mountPath = s.ws.slice(s.ws.indexOf(":") + 1)
    const script = `mkdir -p "$1" ${SANDBOX_HOME} && chown ${SANDBOX_USER} ${SANDBOX_HOME} && mount --bind "$2" "$1"`
    await this.docker("exec", "-u", "0", s.container, "sh", "-c", script, "sh", dir, mountPath)
  }

  /** A terminal or engine still in the directory pins the bind; nothing has changed when this throws. */
  private async unbind(s: LayerfsState, dir: string): Promise<void> {
    try {
      await this.docker("exec", "-u", "0", s.container, "umount", dir)
    } catch (err) {
      if (!/busy/i.test((err as Error).message)) throw err
      throw new Error(
        `WORKSPACE_BUSY: a process still runs in ${dir} inside the sandbox; close the task's terminals first`,
      )
    }
  }

  /**
   * The bind goes BEFORE `workspace unmount`: unmounting under a live bind leaves the Sandbox stuck for good
   * (`Retained(TeardownCustody … Join)`), and only removing its container clears it. A refused unmount
   * (`Dirty`) re-binds, so the task's terminals keep working.
   */
  private async unmount(s: LayerfsState, dir: string, discard: boolean): Promise<void> {
    await this.unbind(s, dir)
    try {
      await this.lfs(s.project, "workspace", "unmount", s.ws, ...(discard ? ["--discard"] : []))
    } catch (err) {
      await this.bind(s, dir)
      if (!/"code":"Dirty"/.test((err as Error).message)) throw err
      throw new Error(`WORKSPACE_DIRTY: LayerFS has uncommitted changes in ${dir}; checkpoint first, or force`)
    }
  }

  private async teardown(s: LayerfsState, dir: string, discard: boolean): Promise<void> {
    if (s.ws) {
      // The task is going: whatever still runs in its directory goes with it, or the bind stays pinned.
      if (s.container) await this.docker("exec", "-u", SANDBOX_USER, s.container, "sh", "-c", KILL_UNDER, "sh", dir)
      await this.unmount(s, dir, discard)
    }
    await this.lfs(s.project, "sandbox", "close", s.sandbox)
    await fs.rm(path.join(dir, STATE_FILE), { force: true })
    await fs.rm(path.join(dir, LAUNCH_PREFIX_FILE), { force: true })
    await fs.rmdir(dir).catch(() => {})
  }

  /** Uncommitted work refuses (`Dirty` from LayerFS) unless `force`; the LayerFS Branch stays in the Store. */
  async dispose(target: DisposeTarget, opts: Parameters<WorkspaceBackend["dispose"]>[1]): Promise<void> {
    const s = await this.load(target.path).catch(() => undefined)
    if (!s) {
      await fs.rm(path.join(target.path, LAUNCH_PREFIX_FILE), { force: true })
      await fs.rmdir(target.path).catch(() => {})
      return
    }
    await this.teardown(s, target.path, opts.force === true)
  }

  /** LayerFS tracks changes since the Workspace's last Commit, not paths: one entry stands for all of them. */
  async dirtyPaths(dir: string): Promise<readonly string[]> {
    const s = await this.load(dir).catch(() => undefined)
    if (!s?.ws) return []
    const { items } = (await this.lfs(s.project, "sandbox", "list_workspaces", s.sandbox)) as {
      items: { path: string; changed: boolean }[]
    }
    const mine = items.find((w) => `${s.sandbox}:${w.path}` === s.ws)
    return mine?.changed ? ["(changes since the last checkpoint, inside the LayerFS sandbox)"] : []
  }

  readonly checkpoints: WorkspaceCheckpointer = {
    take: (dir, opts) => this.take(dir, opts?.tabId),
    list: async (dir) => (await this.load(dir)).checkpoints,
    rewind: async (dir, n) => {
      const s = await this.load(dir)
      const target = s.checkpoints.find((c) => c.n === n)
      if (!target) throw new Error(`CHECKPOINT_NOT_FOUND: checkpoint ${n} does not exist`)
      const undo = (await this.take(dir)).checkpoint
      const after = await this.load(dir)
      const fork = `${after.branch.replace(/-r[0-9a-z]+$/, "")}-r${Date.now().toString(36)}`
      await this.lfs(after.project, "branch", "fork", fork, target.commit)
      // Committed just above, so the discard drops nothing. A refusal leaves the fork behind, unused.
      await this.unmount(after, dir, true)
      after.branch = fork
      await this.mount(after, dir)
      await this.save(dir, after)
      return { target, undo, uncaptured: [] }
    },
  }

  /** `workspace commit`: the whole tree, `.git` and ignored files included. */
  private async take(dir: string, tabId?: string): Promise<TakeCheckpointResult> {
    const s = await this.load(dir)
    const latest = s.checkpoints.at(-1)
    // The first checkpoint forces a Commit so a clean tree still gets an id to rewind to.
    const reply = (await this.lfs(
      s.project,
      "workspace",
      "commit",
      s.ws,
      "-m",
      "rove checkpoint",
      ...(latest ? [] : ["--force"]),
    )) as {
      kind: string
      head: string
      root?: string
      commit?: { root: string }
    }
    if (latest && reply.kind === "UpToDate") return { created: false, checkpoint: latest }
    const checkpoint: CheckpointRecord = {
      n: (latest?.n ?? 0) + 1,
      ref: `layerfs:${s.project}:${s.branch}`,
      commit: reply.head,
      tree: reply.commit?.root ?? reply.root ?? reply.head,
      at: new Date().toISOString(),
      ...(tabId ? { tabId } : {}),
    }
    s.checkpoints.push(checkpoint)
    await this.save(dir, s)
    return { created: true, checkpoint, uncaptured: [] }
  }

  /** `git bundle` of the task branch past its base, fetched into the host repo as the same branch. */
  async exportBranch(
    target: DisposeTarget & { repo: string; branch: string },
  ): Promise<{ branch: string; commit: string }> {
    const s = await this.load(target.path)
    const inner = `/tmp/rove-export-${process.pid}.bundle`
    await this.inSandbox(s, target.path, "git", "bundle", "create", "-q", inner, target.branch, `^${s.gitBase}`)
    const local = path.join(os.tmpdir(), `rove-layerfs-${process.pid}-${Date.now()}.bundle`)
    try {
      await this.docker("cp", `${s.container}:${inner}`, local)
      await this.run("git", ["-C", target.repo, "fetch", "-q", local, `${target.branch}:refs/heads/${target.branch}`])
      const commit = (await this.run("git", ["-C", target.repo, "rev-parse", target.branch])).trim()
      return { branch: target.branch, commit }
    } finally {
      await fs.rm(local, { force: true })
    }
  }

  private async load(dir: string): Promise<LayerfsState> {
    return JSON.parse(await fs.readFile(path.join(dir, STATE_FILE), "utf8")) as LayerfsState
  }

  private save(dir: string, s: LayerfsState): Promise<void> {
    return fs.writeFile(path.join(dir, STATE_FILE), `${JSON.stringify(s, null, 2)}\n`)
  }
}

function unavailable(why: string): Error {
  return new Error(`LAYERFS_UNAVAILABLE: the layerfs workspace backend is unavailable: ${why}`)
}
