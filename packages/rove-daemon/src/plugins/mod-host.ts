/**
 * Mods: one long-lived process per enabled plugin that declares `[mod]`. The
 * process speaks JSON lines on stdio — it sends element trees, the host sends
 * presses — so a mod can be written in any language; the SDK's `runMod` is
 * sugar. Every tree is validated against the shared contract before it is
 * published on `mod.ui`, which the TUI and (through rove-bridge) the web both
 * render. The mod owns its state; clients only draw the last published tree.
 *
 * Wire, one JSON object per line:
 *   mod → host  {"type":"pane","id","title","tree"} | {"type":"close","id"}
 *   host → mod  {"type":"press","pane","key"}
 *
 * Out of process on purpose: a mod that spins or crashes must cost its own
 * panes, not the daemon every task depends on.
 */

import { type ChildProcess, spawn } from "node:child_process"
import { mkdirSync } from "node:fs"
import {
  MOD_PANE_ID_PATTERN,
  MOD_TITLE_MAX,
  type ModNode,
  type ModPaneView,
  validateModTree,
} from "@sma1lboy/rove-plugin-sdk/contract"
import { OWNER_ONLY_DIR_MODE } from "../daemon/owner-only.ts"
import { buildPluginEnv } from "./env.ts"
import { appendPluginLogRecord } from "./hook-run.ts"
import type { PluginCommandSpec } from "./manifest.ts"
import { pluginConfigDir, pluginStateDir } from "./plugin-paths.ts"

/** Panes one mod may hold open; past this a `pane` message is refused. */
export const MOD_MAX_PANES = 8
/** Longest stdout line read; a longer one is dropped, not buffered forever. */
const MAX_LINE_BYTES = 512 * 1024
const RESTART_MIN_MS = 1_000
const RESTART_MAX_MS = 30_000
/** A run this long resets the restart backoff. */
const HEALTHY_RUN_MS = 60_000

export interface ModSpec {
  readonly pluginId: string
  readonly root: string
  readonly mod: PluginCommandSpec
}

export interface ModHostOptions {
  readonly homeDir?: string
  readonly socketPath: string
  readonly binPath: string
  readonly publish: (panes: readonly ModPaneView[]) => void
  readonly log?: (line: string) => void
}

export type ModPressOutcome = "sent" | "no-mod" | "no-pane" | "no-key"

interface Running {
  readonly spec: ModSpec
  child: ChildProcess | null
  startedAt: number
  backoffMs: number
  restartTimer: ReturnType<typeof setTimeout> | undefined
  /** pane id → its last valid view, in open order. */
  readonly panes: Map<string, ModPaneView>
}

function treeHasKey(node: ModNode, key: string): boolean {
  if (node.type === "button") return node.key === key
  if (node.type === "box") return node.children.some((child) => treeHasKey(child, key))
  return false
}

export class ModHost {
  private readonly opts: ModHostOptions
  private readonly mods = new Map<string, Running>()
  private stopped = false

  constructor(opts: ModHostOptions) {
    this.opts = opts
  }

  /** Reconcile with the enabled plugins: start new mods, stop gone or changed ones. */
  sync(specs: readonly ModSpec[]): void {
    if (this.stopped) return
    const next = new Map(specs.map((s) => [s.pluginId, s]))
    for (const [id, running] of this.mods) {
      const spec = next.get(id)
      if (!spec || spec.root !== running.spec.root || !sameCommand(spec.mod, running.spec.mod)) this.retire(id)
    }
    for (const spec of specs) if (!this.mods.has(spec.pluginId)) this.launch(spec)
    this.publish()
  }

  /** Forward a press to the mod that drew `key`. */
  press(pluginId: string, paneId: string, key: string): ModPressOutcome {
    const running = this.mods.get(pluginId)
    if (!running?.child?.stdin?.writable) return "no-mod"
    const pane = running.panes.get(paneId)
    if (!pane) return "no-pane"
    // A stale client can press a button the mod has since removed.
    if (!treeHasKey(pane.tree, key)) return "no-key"
    running.child.stdin.write(`${JSON.stringify({ type: "press", pane: paneId, key })}\n`)
    return "sent"
  }

  panes(): ModPaneView[] {
    return [...this.mods.values()].flatMap((m) => [...m.panes.values()])
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    for (const id of [...this.mods.keys()]) this.retire(id)
  }

  private publish(): void {
    this.opts.publish(this.panes())
  }

  private retire(pluginId: string): void {
    const running = this.mods.get(pluginId)
    if (!running) return
    this.mods.delete(pluginId)
    if (running.restartTimer) clearTimeout(running.restartTimer)
    if (running.child) killGroup(running.child)
    running.child = null
  }

  private launch(spec: ModSpec): void {
    const running: Running = {
      spec,
      child: null,
      startedAt: 0,
      backoffMs: RESTART_MIN_MS,
      restartTimer: undefined,
      panes: new Map(),
    }
    this.mods.set(spec.pluginId, running)
    this.spawnChild(running)
  }

  private record(running: Running, record: Record<string, unknown>): void {
    appendPluginLogRecord(running.spec.pluginId, this.opts.homeDir, { at: Date.now(), kind: "mod", ...record })
  }

  private spawnChild(running: Running): void {
    const { pluginId, root, mod } = running.spec
    const [cmd, ...args] = mod.command
    let child: ChildProcess
    try {
      mkdirSync(pluginConfigDir(pluginId, this.opts.homeDir), { recursive: true, mode: OWNER_ONLY_DIR_MODE })
      mkdirSync(pluginStateDir(pluginId, this.opts.homeDir), { recursive: true, mode: OWNER_ONLY_DIR_MODE })
      child = spawn(cmd as string, args, {
        cwd: root,
        env: buildPluginEnv({
          homeDir: this.opts.homeDir,
          socketPath: this.opts.socketPath,
          binPath: this.opts.binPath,
          pluginId,
          pluginRoot: root,
          extra: { ROVE_PLUGIN_EVENT: "mod" },
        }),
        stdio: ["pipe", "pipe", "pipe"],
        // Own process group, so retiring the mod takes its children too.
        detached: true,
      })
    } catch (err) {
      this.record(running, { spawnError: String(err) })
      this.scheduleRestart(running)
      return
    }
    running.child = child
    running.startedAt = Date.now()
    this.record(running, { phase: "started", command: mod.command })
    // A mod that exits while we write must not raise EPIPE in the daemon.
    child.stdin?.on("error", () => {})
    readLines(child, "stdout", (line) => this.onLine(running, child, line))
    readLines(child, "stderr", (line) => this.record(running, { stderr: line.slice(0, 2048) }))
    child.on("error", (err) => this.record(running, { spawnError: String(err) }))
    child.on("close", (code, signal) => {
      if (running.child !== child) return
      running.child = null
      this.record(running, { phase: "exited", exitCode: code, ...(signal ? { signal } : {}) })
      this.opts.log?.(`mod ${pluginId} exited (${signal ?? `exit ${code}`})`)
      if (running.panes.size > 0) {
        running.panes.clear()
        this.publish()
      }
      if (Date.now() - running.startedAt >= HEALTHY_RUN_MS) running.backoffMs = RESTART_MIN_MS
      this.scheduleRestart(running)
    })
  }

  private scheduleRestart(running: Running): void {
    if (this.stopped || this.mods.get(running.spec.pluginId) !== running) return
    const delay = running.backoffMs
    running.backoffMs = Math.min(running.backoffMs * 2, RESTART_MAX_MS)
    running.restartTimer = setTimeout(() => {
      running.restartTimer = undefined
      if (this.stopped || this.mods.get(running.spec.pluginId) !== running) return
      this.spawnChild(running)
    }, delay)
    running.restartTimer.unref?.()
  }

  private onLine(running: Running, child: ChildProcess, line: string): void {
    if (running.child !== child || line.trim() === "") return
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line)
    } catch {
      this.record(running, { refused: "stdout line is not JSON", line: line.slice(0, 200) })
      return
    }
    const refused = this.apply(running, msg)
    // The last good tree stays on screen; the author reads why in the log.
    if (refused) this.record(running, { refused })
  }

  /** Apply one mod message; the refusal reason, or null when it applied. */
  private apply(running: Running, msg: Record<string, unknown>): string | null {
    if (typeof msg.id !== "string" || !MOD_PANE_ID_PATTERN.test(msg.id)) return "bad pane id"
    if (msg.type === "close") {
      if (running.panes.delete(msg.id)) this.publish()
      return null
    }
    if (msg.type !== "pane") return `unknown message type ${JSON.stringify(msg.type)}`
    if (typeof msg.title !== "string" || msg.title.length === 0 || msg.title.length > MOD_TITLE_MAX) {
      return `pane ${msg.id}: title must be 1-${MOD_TITLE_MAX} chars`
    }
    if (!running.panes.has(msg.id) && running.panes.size >= MOD_MAX_PANES) {
      return `pane ${msg.id}: more than ${MOD_MAX_PANES} panes`
    }
    const tree = validateModTree(msg.tree)
    if (!tree.ok) return `pane ${msg.id}: ${tree.error}`
    running.panes.set(msg.id, { plugin: running.spec.pluginId, id: msg.id, title: msg.title, tree: tree.tree })
    this.publish()
    return null
  }
}

function sameCommand(a: PluginCommandSpec, b: PluginCommandSpec): boolean {
  return a.command.length === b.command.length && a.command.every((part, i) => part === b.command[i])
}

function killGroup(child: ChildProcess): void {
  try {
    if (child.pid) process.kill(-child.pid, "SIGTERM")
    else child.kill("SIGTERM")
  } catch {
    child.kill("SIGTERM")
  }
}

function readLines(child: ChildProcess, stream: "stdout" | "stderr", onLine: (line: string) => void): void {
  let buf = ""
  child[stream]?.on("data", (chunk: Buffer) => {
    buf += chunk.toString()
    let nl = buf.indexOf("\n")
    while (nl >= 0) {
      onLine(buf.slice(0, nl))
      buf = buf.slice(nl + 1)
      nl = buf.indexOf("\n")
    }
    if (buf.length > MAX_LINE_BYTES) buf = ""
  })
}
