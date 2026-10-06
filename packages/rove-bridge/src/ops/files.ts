/**
 * Files area: the worktree file list (F1), diff review notes (F5) and the Worktrees page (P10).
 * Each op wraps ONE Rove helper, verb or RPC. Review notes live where the TUI keeps them
 * (`state.json` key `diffComments.<taskId>`), read and written through the TUI's own helpers.
 * An attached TUI hydrates that key once, so it only sees notes written here after a restart.
 */

import { updateStateFile } from "@sma1lboy/rove/src/state/store.ts"
import {
  type DiffComment,
  diffCommentsKey,
  formatDiffComments,
  unsentComments,
} from "@sma1lboy/rove/src/tui/ops/diff-comments.ts"
import { listFiles } from "@sma1lboy/rove/src/tui/panes/filetree/git.ts"
import { BridgeError, optInt } from "../protocol.ts"
import { absPath, bool, flag, tabId, taskId, text } from "./args.ts"
import type { Args, BridgeApi, OpSpec, OpTable } from "./types.ts"

/** Beyond this the phone gets the first slice and `truncated: true`. */
export const MAX_FILES = 50_000
const MAX_NOTES = 200
const NOTE_MAX = 4_000
const PATH_MAX = 1_024
const MAX_LINE = 10_000_000

/** Where review notes are kept. Defaults to `state.json`; tests inject a fake. */
export interface NoteStore {
  read(taskId: string): readonly DiffComment[]
  /** Locked read-modify-write of one task's notes. */
  update(taskId: string, mutate: (notes: readonly DiffComment[]) => readonly DiffComment[]): void
}

export const stateNoteStore: NoteStore = {
  read(id) {
    let notes: readonly DiffComment[] = []
    // A read is a no-write update: same lock, same fresh read the TUI's writers use.
    updateStateFile((state) => {
      const v = state[diffCommentsKey(id)]
      notes = Array.isArray(v) ? (v as DiffComment[]) : []
      return false
    })
    return notes
  },
  update(id, mutate) {
    updateStateFile((state) => {
      const v = state[diffCommentsKey(id)]
      state[diffCommentsKey(id)] = mutate(Array.isArray(v) ? (v as DiffComment[]) : []) as never
      return undefined
    })
  },
}

export interface FilesDeps {
  readonly listFiles: (worktree: string) => Promise<string[]>
  readonly notes: NoteStore
  readonly now: () => number
  readonly newId: () => string
}

const defaultDeps: FilesDeps = {
  listFiles: (worktree) => listFiles(worktree),
  notes: stateNoteStore,
  now: Date.now,
  newId: () => crypto.randomUUID(),
}

interface TaskGet {
  readonly task: { readonly worktreePath?: string | null }
}

async function worktreeOf(api: BridgeApi, id: string): Promise<string> {
  const res = await api.verb<TaskGet>("get-task", [flag("task-id", id)])
  const path = res.task.worktreePath
  if (!path) throw new BridgeError("NO_WORKTREE", `task ${id} has no worktree yet`)
  return path
}

/** A worktree-relative path: never absolute, never climbing out. */
function relPath(args: Args, name: string): string {
  const v = text(args, name, PATH_MAX)
  if (v.startsWith("/") || v.includes("\0") || v.split(/[\\/]/).includes("..")) {
    throw new BridgeError("BAD_ARGS", `${name} must be relative to the worktree`)
  }
  return v
}

function lineNo(args: Args, name: string): number {
  const v = optInt(args, name, 1, MAX_LINE)
  if (v === undefined) throw new BridgeError("BAD_ARGS", `${name} must be an integer in 1..${MAX_LINE}`)
  return v
}

const samePath = (a: string, b: string): boolean => a.replace(/^\/private\//, "/") === b.replace(/^\/private\//, "/")

interface WorktreeRow {
  readonly path: string
  readonly [k: string]: unknown
}
interface WorktreeProjectRow {
  readonly repo: string
  readonly worktrees: readonly WorktreeRow[]
}
interface TaskListRes {
  readonly tasks: readonly { readonly id: string; readonly kind?: string; readonly worktreePath?: string | null }[]
}

export function createFilesOps(deps: FilesDeps = defaultDeps): OpTable {
  const spec = (s: OpSpec): OpSpec => s
  return {
    "files.list": spec({
      kind: "read",
      destructive: false,
      wraps: "listFiles(worktree) — tracked + untracked-not-ignored files",
      async run(args, { api }) {
        const worktree = await worktreeOf(api, taskId(args))
        const all = await deps.listFiles(worktree)
        const truncated = all.length > MAX_FILES
        return { files: truncated ? all.slice(0, MAX_FILES) : all, truncated }
      },
    }),

    "review.list": spec({
      kind: "read",
      destructive: false,
      wraps: "state.json diffComments.<taskId>",
      async run(args) {
        const notes = deps.notes.read(taskId(args))
        return { notes, unsent: unsentComments(notes as DiffComment[]).length }
      },
    }),

    "review.add": spec({
      kind: "write",
      destructive: false,
      wraps: "state.json diffComments.<taskId> (append)",
      async run(args) {
        const id = taskId(args)
        const line = lineNo(args, "line")
        const startLine = optInt(args, "startLine", 1, MAX_LINE)
        if (startLine !== undefined && startLine > line) throw new BridgeError("BAD_ARGS", "startLine is after line")
        const note: DiffComment = {
          id: deps.newId(),
          filePath: relPath(args, "filePath"),
          ...(startLine !== undefined && startLine !== line ? { startLine } : {}),
          line,
          body: text(args, "body", NOTE_MAX),
          createdAt: deps.now(),
        }
        deps.notes.update(id, (cur) => {
          if (cur.length >= MAX_NOTES)
            throw new BridgeError("TOO_MANY_NOTES", `a task keeps at most ${MAX_NOTES} notes`)
          return [...cur, note]
        })
        return { note }
      },
    }),

    "review.remove": spec({
      kind: "write",
      destructive: true,
      wraps: "state.json diffComments.<taskId> (drop one note)",
      async run(args) {
        const id = taskId(args)
        const noteId = text(args, "id", 128)
        let removed = false
        deps.notes.update(id, (cur) => {
          const next = cur.filter((c) => c.id !== noteId)
          removed = next.length !== cur.length
          return next
        })
        return { removed }
      },
    }),

    "review.send": spec({
      kind: "write",
      destructive: false,
      wraps: "rove api send --plain (all unsent notes as one prompt; sentAt only on confirmed delivery)",
      async run(args, { api }) {
        const id = taskId(args)
        const tab = args.tabId === undefined || args.tabId === null || args.tabId === "" ? undefined : tabId(args)
        const unsent = unsentComments(deps.notes.read(id) as DiffComment[])
        if (unsent.length === 0) return { sent: 0, delivered: true }
        const worktree = await worktreeOf(api, id).catch(() => undefined)
        const prompt = formatDiffComments(unsent, worktree)
        const res = await api.verb<{
          delivered?: boolean
          targetState?: string
          targetDetail?: string
          reason?: string
        }>("send", [flag("task-id", id), "--plain", flag("prompt", prompt), ...(tab ? [flag("tab", tab)] : [])])
        // A refused or unconfirmed send leaves every note unsent; the verb throws on a refusal.
        if (res.delivered !== true || res.targetState) {
          return {
            sent: 0,
            delivered: false,
            reason:
              res.targetDetail ?? res.reason ?? (res.targetState ? `engine is ${res.targetState}` : "not confirmed"),
          }
        }
        const batch = new Set(unsent.map((c) => c.id))
        const sentAt = deps.now()
        deps.notes.update(id, (cur) =>
          cur.map((c) => (batch.has(c.id) && c.sentAt === undefined ? { ...c, sentAt } : c)),
        )
        return { sent: unsent.length, delivered: true }
      },
    }),

    "worktrees.list": spec({
      kind: "read",
      destructive: false,
      wraps: "daemon RPC worktree.list {network} + task.list (taskId/taskKind joined by path)",
      async run(args, { api }) {
        const network = args.network === undefined ? true : args.network === true
        if (args.network !== undefined && typeof args.network !== "boolean") {
          throw new BridgeError("BAD_ARGS", "network must be a boolean")
        }
        const [list, tasks] = await Promise.all([
          api.rpc<{ projects: readonly WorktreeProjectRow[] }>("worktree.list", { network }),
          api.rpc<TaskListRes>("task.list"),
        ])
        return {
          projects: list.projects.map((p) => ({
            repo: p.repo,
            worktrees: p.worktrees.map((w) => {
              const t = tasks.tasks.find((x) => x.worktreePath && samePath(x.worktreePath, w.path))
              return t ? { ...w, taskId: t.id, taskKind: t.kind ?? "task" } : w
            }),
          })),
        }
      },
    }),

    "worktrees.remove": spec({
      kind: "write",
      destructive: true,
      wraps: "daemon RPC worktree.remove {path, force}",
      async run(args, { api }) {
        const path = absPath(args, "path")
        const force = bool(args, "force")
        // Only a path the audit itself lists can be removed: the phone never names an arbitrary directory.
        const known = await api.rpc<{ projects: readonly WorktreeProjectRow[] }>("worktree.list", { network: false })
        if (!known.projects.some((p) => p.worktrees.some((w) => w.path === path))) {
          throw new BridgeError("UNKNOWN_WORKTREE", "that path is not a listed worktree")
        }
        try {
          const res = await api.rpc<{ removed: boolean; residue?: { path: string; reason: string } }>(
            "worktree.remove",
            { path, force },
          )
          return { removed: res.removed, ...(res.residue ? { residue: res.residue } : {}) }
        } catch (err) {
          // The page discriminates a dirty refusal on this prefix; give the app a stable code.
          if (err instanceof BridgeError && err.message.startsWith("DIRTY_WORKTREE: ")) {
            throw new BridgeError("DIRTY_WORKTREE", err.message.slice("DIRTY_WORKTREE: ".length))
          }
          throw err
        }
      },
    }),
  }
}

export const filesOps: OpTable = createFilesOps()
