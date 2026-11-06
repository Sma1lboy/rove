/**
 * Run action ops: a repo's `.rove/run.sh` started as a shell tab of the task, with a port of its own.
 * The client names a task, never a command: the line typed into the shell is built here, from the repo's
 * committed file. A task keeps one port (`run.tasks` in state.json) from a range (`run.portBase`,
 * `run.portCount`) no other task holds, so parallel worktrees running the same dev server never collide.
 * Whether it serves is read from the machine's listeners, not from what the script prints.
 */

import { createServer } from "node:net"
import { join } from "node:path"
import { isNonEmptyRepoFile } from "@sma1lboy/rove/src/lib/repo-config-file.ts"
import { type StateSnapshot, loadStateFile, updateStateFile } from "@sma1lboy/rove/src/state/store.ts"
import { BridgeError } from "../protocol.ts"
import { flag, taskId } from "./args.ts"
import type { BridgeApi, OpTable } from "./types.ts"

export const RUN_TASKS_KEY = "run.tasks"
const BASE_KEY = "run.portBase"
const COUNT_KEY = "run.portCount"
const DEFAULT_BASE = 4100
const DEFAULT_COUNT = 900
const SCRIPT = ".rove/run.sh"
const TAB_TITLE = "run"

/** What a task's run holds: its port for good, and the tab while one is open. */
interface RunRecord {
  readonly port: number
  readonly session?: string
  readonly taskId?: string
  readonly tabId?: string
}

export interface RunDeps {
  readonly load: () => StateSnapshot
  readonly update: (compute: (fresh: StateSnapshot) => StateSnapshot) => void
  /** Nothing holds `port` on this machine. */
  readonly portFree: (port: number) => Promise<boolean>
  readonly hasScript: (worktree: string) => boolean
}

const realDeps: RunDeps = {
  load: loadStateFile,
  update: (compute) =>
    void updateStateFile((state) => {
      for (const [key, value] of Object.entries(compute(state))) state[key] = value
      return undefined
    }),
  portFree: (port) => {
    const { promise, resolve } = Promise.withResolvers<boolean>()
    const probe = createServer()
    probe.once("error", () => resolve(false))
    probe.listen(port, () => probe.close(() => resolve(true)))
    return promise
  },
  hasScript: (worktree) => isNonEmptyRepoFile(join(worktree, SCRIPT)),
}

export function readRecords(state: StateSnapshot): Record<string, RunRecord> {
  const raw = state[RUN_TASKS_KEY]
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const out: Record<string, RunRecord> = {}
  for (const [id, value] of Object.entries(raw)) {
    const r = value as Record<string, unknown> | null
    if (!r || typeof r.port !== "number" || !Number.isInteger(r.port)) continue
    out[id] = {
      port: r.port,
      ...(typeof r.session === "string" ? { session: r.session } : {}),
      ...(typeof r.taskId === "string" ? { taskId: r.taskId } : {}),
      ...(typeof r.tabId === "string" ? { tabId: r.tabId } : {}),
    }
  }
  return out
}

/** The configured range, falling back to the default when a hand-edited value is not a usable one. */
export function portRange(state: StateSnapshot): { base: number; count: number } {
  const base = state[BASE_KEY]
  const count = state[COUNT_KEY]
  const okBase = typeof base === "number" && Number.isInteger(base) && base >= 1024 && base <= 65535
  const okCount = typeof count === "number" && Number.isInteger(count) && count >= 1
  const start = okBase ? base : DEFAULT_BASE
  const size = okCount ? count : DEFAULT_COUNT
  return { base: start, count: Math.max(1, Math.min(size, 65536 - start)) }
}

/**
 * `own` while it is free or still ours; otherwise the lowest port of the range that no other task holds and
 * nothing listens on. Stable: a task that keeps its port never moves.
 */
export async function pickPort(
  range: { base: number; count: number },
  taken: ReadonlySet<number>,
  own: number | undefined,
  running: boolean,
  portFree: RunDeps["portFree"],
): Promise<number> {
  if (own !== undefined && (running || (await portFree(own)))) return own
  for (let port = range.base; port < range.base + range.count; port++) {
    if (!taken.has(port) && port !== own && (await portFree(port))) return port
  }
  throw new BridgeError("NO_PORT", `no free port in ${range.base}-${range.base + range.count - 1}`)
}

interface Session {
  readonly key: string
  readonly alive: boolean
}

interface Listener {
  readonly port: number
}

async function worktreeOf(api: BridgeApi, id: string): Promise<string | undefined> {
  const res = await api.verb<{ task?: { worktreePath?: string } }>("get-task", [flag("task-id", id)])
  return res.task?.worktreePath || undefined
}

/** What every run op answers: whether the repo has a run script, whether its tab is alive, and where it serves. */
export interface RunAnswer {
  readonly script: boolean
  readonly running: boolean
  readonly port: number | null
  /** Something listens on `port`. */
  readonly listening: boolean
  readonly url: string | null
}

interface RunState extends RunAnswer {
  readonly record: RunRecord | undefined
}

export function runOps(deps: RunDeps = realDeps): OpTable {
  async function state(api: BridgeApi, id: string): Promise<RunState> {
    // Another machine's rows run nothing here.
    const worktree = api.machineOf?.(id) === undefined ? await worktreeOf(api, id) : undefined
    const script = !!worktree && deps.hasScript(worktree)
    const record = readRecords(deps.load())[id]
    const port = record?.port ?? null
    if (!script) return { script, running: false, port, listening: false, url: null, record }
    let running = false
    if (record?.session) {
      const { sessions } = await api.verb<{ sessions?: readonly Session[] }>("pty-list", [])
      running = !!sessions?.some((s) => s.key === record.session && s.alive)
    }
    let listening = false
    if (running && record) {
      const res = await api.verb<{ ports?: readonly Listener[] | null }>("ports", ["--all"])
      listening = !!res.ports?.some((p) => p.port === record.port)
    }
    const url = listening && record ? `http://localhost:${record.port}` : null
    return { script, running, port, listening, url, record }
  }

  const answer = ({ script, running, port, listening, url }: RunState): RunAnswer => ({
    script,
    running,
    port,
    listening,
    url,
  })

  return {
    "run.status": {
      kind: "read",
      destructive: false,
      wraps:
        "rove api get-task + pty-list + ports --all (is `.rove/run.sh` there, is its tab alive, does its port listen)",
      async run(a, { api }) {
        return answer(await state(api, taskId(a)))
      },
    },

    "run.start": {
      kind: "write",
      destructive: false,
      wraps:
        "rove api tab-new --kind shell --type `env PORT=<port> sh .rove/run.sh` (the repo's own committed file; no client text)",
      async run(a, { api }) {
        const id = taskId(a)
        const now = await state(api, id)
        if (!now.script) throw new BridgeError("NO_RUN_SCRIPT", `this task's repo has no ${SCRIPT}`)
        if (now.running) return answer(now)
        const all = readRecords(deps.load())
        const taken = new Set(Object.entries(all).flatMap(([other, r]) => (other === id ? [] : [r.port])))
        const port = await pickPort(portRange(deps.load()), taken, now.record?.port, false, deps.portFree)
        const line = `env PORT=${port} ROVE_PORT=${port} sh ${SCRIPT}`
        const opened = await api.verb<{ tabId?: string; session?: string; childTaskId?: string }>("tab-new", [
          flag("task-id", id),
          flag("kind", "shell"),
          flag("type", line),
        ])
        if (!opened.tabId || !opened.session) throw new BridgeError("SESSION_FAILED", "the run tab did not open")
        const owner = opened.childTaskId ?? id
        await api
          .verb("update", [flag("task-id", owner), flag("tab", opened.tabId), flag("title", `${TAB_TITLE} :${port}`)])
          .catch(() => {})
        deps.update((fresh) => ({
          [RUN_TASKS_KEY]: {
            ...readRecords(fresh),
            [id]: { port, session: opened.session, taskId: owner, tabId: opened.tabId },
          },
        }))
        return { script: true, running: true, port, listening: false, url: null }
      },
    },

    "run.stop": {
      kind: "write",
      destructive: false,
      wraps: "rove api tab-close on the run tab (its shell and the server under it end); the task keeps its port",
      async run(a, { api }) {
        const id = taskId(a)
        const record = readRecords(deps.load())[id]
        if (record?.session && record.taskId && record.tabId) {
          await api.verb("tab-close", [flag("task-id", record.taskId), flag("tab", record.tabId)]).catch(() => {})
          deps.update((fresh) => ({ [RUN_TASKS_KEY]: { ...readRecords(fresh), [id]: { port: record.port } } }))
        }
        return answer(await state(api, id))
      },
    },
  }
}

export const RUN_OPS: OpTable = runOps()
