/**
 * The experimental `layerfs` backend through the Orchestrator. Only the outside world (sudo, the LayerFS CLI,
 * docker) is a fake, and it holds LayerFS's real invariants: unmounting under a live bind leaves the Sandbox stuck,
 * a bind with a process in it refuses umount, and a dirty Workspace refuses unmount without discard.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Orchestrator } from "../../src/orchestrator/core.ts"
import { TaskIndexStore } from "../../src/orchestrator/index/store.ts"
import {
  BorrowedBackend,
  GitWorktreeBackend,
  LayerfsBackend,
  WorkspaceRegistry,
} from "../../src/orchestrator/workspace/index.ts"
import type { Run } from "../../src/orchestrator/workspace/layerfs.ts"
import { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"

const CLI = "/opt/layerfs/cli.js"

/** LayerFS + docker as one process-free model, keyed the way the real CLI answers. */
class FakeRunner {
  sudo = true
  stuck = false
  readonly binds = new Map<string, string>() // host path inside the container -> /workspaces/N
  readonly busy = new Set<string>()
  readonly mounts = new Map<string, { branch: string; dirty: boolean; head?: string }>()
  readonly log: string[] = []
  private commits = 0

  run: Run = async (file, args) => {
    if (file === "sudo" && args[1] === "true") {
      if (!this.sudo) throw new Error("sudo: a password is required")
      return ""
    }
    if (file === "sudo") return JSON.stringify(this.lfs(args.slice(args.indexOf(CLI) + 1)))
    if (file === "docker") return this.docker(args)
    throw new Error(`unexpected ${file}`)
  }

  private lfs([family, call, ...rest]: readonly string[]): unknown {
    this.log.push(`lfs ${family} ${call}`)
    if (this.stuck) throw new Error('{"code":"Failed","message":"Retained(TeardownCustody … Join)"}')
    const ws = rest[0] as string
    switch (`${family} ${call}`) {
      case "workspace mount": {
        const n = this.mounts.size + 1
        this.mounts.set(`1:/workspaces/${n}`, { branch: rest[1] as string, dirty: false })
        return { ws: `1:/workspaces/${n}`, path: `/workspaces/${n}` }
      }
      case "workspace unmount": {
        const m = this.mounts.get(ws)
        if ([...this.binds.values()].includes(ws.slice(2))) {
          this.stuck = true
          throw new Error('{"code":"Failed","message":"Retained(TeardownCustody … Join)"}')
        }
        if (m?.dirty && !rest.includes("--discard"))
          throw new Error('{"code":"Dirty","message":"1 uncommitted change(s)"}')
        this.mounts.delete(ws)
        return { kind: "Unmounted" }
      }
      case "workspace commit": {
        const m = this.mounts.get(ws) as { dirty: boolean; head?: string }
        if (!m.dirty && !rest.includes("--force") && m.head) return { kind: "UpToDate", head: m.head }
        m.head = `c${++this.commits}`
        m.dirty = false
        return { kind: "Committed", head: m.head, commit: { root: `r${this.commits}` } }
      }
      case "sandbox create":
        return { sandbox: "1" }
      case "sandbox close":
        return { kind: "Closed" }
      case "sandbox list_workspaces":
        return { items: [...this.mounts].map(([w, m]) => ({ path: w.slice(2), changed: m.dirty })) }
      default:
        return {}
    }
  }

  private docker(args: readonly string[]): string {
    if (args[0] === "ps") return "c0ffee\n"
    if (args[0] !== "exec") throw new Error(`docker ${args[0]}`)
    const i = args.indexOf("c0ffee")
    const argv = args.slice(i + 1)
    if (argv[0] === "umount") {
      this.log.push("umount")
      if (this.busy.has(argv[1] as string)) throw new Error(`umount: ${argv[1]}: target is busy.`)
      this.binds.delete(argv[1] as string)
    } else if (argv[0] === "sh" && argv[2]?.includes("mount --bind")) {
      this.binds.set(argv[4] as string, argv[5] as string)
    } else if (argv[0] === "sh" && argv[2]?.includes("readlink")) {
      this.busy.delete(argv[4] as string)
    }
    return "abc123\n"
  }

  dirty(): void {
    for (const m of this.mounts.values()) m.dirty = true
  }
}

let tmp: string
let repo: string
let fake: FakeRunner
let config: string | undefined
let store: TaskIndexStore
let orch: Orchestrator

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rove-layerfs-"))
  repo = path.join(tmp, "repo")
  fs.mkdirSync(repo)
  config = path.join(tmp, "layerfs.env")
  fs.writeFileSync(
    config,
    `LAYERFS_CLI=${CLI}\nLAYERFS_NODE=/usr/bin/node\nLAYERFS_HOME=/root/lfs\nLAYERFS_STORE_PATH=/s.sqlite\nexport LAYERFS_IMAGE=sha256:1\n`,
  )
  fake = new FakeRunner()
  vi.stubEnv("ROVE_HOME_DIR", path.join(tmp, "home"))
  store = new TaskIndexStore({ homeDir: path.join(tmp, "home") })
  await store.load()
  const worktrees = new GitWorktreeManager()
  const layerfs = new LayerfsBackend({ run: fake.run, configPath: () => config, platform: "linux" })
  const workspaces = new WorkspaceRegistry([new GitWorktreeBackend(worktrees), new BorrowedBackend(), layerfs])
  orch = new Orchestrator({ store, worktrees, workspaces })
})

afterEach(() => {
  orch.dispose()
  vi.unstubAllEnvs()
  fs.rmSync(tmp, { recursive: true, force: true })
})

async function layerfsTask(): Promise<{ id: string; dir: string }> {
  const task = await orch.createTask({ repo, title: "lfs", branch: "feat", workspace: { backend: "layerfs" } })
  return { id: String(task.id), dir: await orch.ensureWorktree(task.id) }
}

describe("layerfs workspace backend", () => {
  it("refuses to create a task while the experimental flag is unset, leaving no row", async () => {
    config = undefined
    await expect(orch.createTask({ repo, title: "x", workspace: { backend: "layerfs" } })).rejects.toThrow(
      /^LAYERFS_UNAVAILABLE: .*experimental\.layerfs/,
    )
    expect(store.list()).toHaveLength(0)
  })

  it("refuses to create a task when sudo would prompt, leaving no row", async () => {
    fake.sudo = false
    await expect(orch.createTask({ repo, title: "x", workspace: { backend: "layerfs" } })).rejects.toThrow(
      /^LAYERFS_NEEDS_ROOT: /,
    )
    expect(store.list()).toHaveLength(0)
  })

  it("launches terminals inside the sandbox at the task's own path", async () => {
    const { dir } = await layerfsTask()
    const launch = JSON.parse(fs.readFileSync(path.join(dir, ".rove-launch.json"), "utf8"))
    expect(launch.prefix).toEqual(expect.arrayContaining(["docker", "exec", "-it", "-w", dir, "c0ffee"]))
    expect(launch.prefix).toContain("ROVE_LAUNCH={launch}")
    expect(launch.reap.at(-1)).toBe("ROVE_LAUNCH={launch}")
    expect(fake.binds.get(dir)).toBe("/workspaces/1")
  })

  it("checkpoints through LayerFS commits and skips an unchanged tree", async () => {
    const { id } = await layerfsTask()
    expect(orch.canCheckpoint(id)).toBe(true)
    const first = await orch.takeCheckpoint(id)
    expect(first).toMatchObject({ created: true, checkpoint: { n: 1, commit: "c1" } })
    expect(await orch.takeCheckpoint(id)).toMatchObject({ created: false, checkpoint: { n: 1 } })
    fake.dirty()
    expect(await orch.takeCheckpoint(id)).toMatchObject({ created: true, checkpoint: { n: 2, commit: "c2" } })
    expect((await orch.listCheckpoints(id)).map((c) => c.n)).toEqual([1, 2])
  })

  it("rewinds onto a fork of the checkpoint, re-bound at the same path", async () => {
    const { id, dir } = await layerfsTask()
    await orch.takeCheckpoint(id)
    fake.dirty()
    const result = await orch.rewindToCheckpoint(id, 1)
    expect(result).toMatchObject({ target: { n: 1 }, undo: { n: 2 } })
    expect(fake.stuck).toBe(false)
    expect(fake.binds.get(dir)).toBe("/workspaces/1")
    expect([...fake.mounts.values()].map((m) => m.branch)).toEqual([expect.stringMatching(/-r[0-9a-z]+$/)])
  })

  it("refuses a rewind while a terminal runs in the directory, and changes nothing", async () => {
    const { id, dir } = await layerfsTask()
    await orch.takeCheckpoint(id)
    fake.busy.add(dir)
    await expect(orch.rewindToCheckpoint(id, 1)).rejects.toThrow(/^WORKSPACE_BUSY: /)
    expect(fake.binds.get(dir)).toBe("/workspaces/1")
    expect(fake.mounts.size).toBe(1)
  })

  it("refuses to delete unsaved work up front, then deletes without leaving the sandbox stuck", async () => {
    const { id, dir } = await layerfsTask()
    fake.dirty()
    await expect(orch.deleteTask(id)).rejects.toThrow(/uncommitted|untracked/)
    expect(store.get(id)?.deletion).toBeUndefined()
    await orch.takeCheckpoint(id)
    fake.busy.add(dir) // a leftover process in the directory is killed, not left pinning the bind
    await orch.deleteTask(id)
    expect(fake.stuck).toBe(false)
    expect(fake.log.indexOf("umount")).toBeLessThan(fake.log.lastIndexOf("lfs workspace unmount"))
    expect(fake.mounts.size).toBe(0)
    expect(fs.existsSync(dir)).toBe(false)
    expect(store.get(id)).toBeUndefined()
  })
})
