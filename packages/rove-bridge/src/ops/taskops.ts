/**
 * Task-row verbs the TUI sidebar menu and new-task dialog need beyond the basic
 * task ops: land preflight, sync with base, fix failing checks, Scratch, engine
 * change with model/effort, and the two reads behind the dialog's path and
 * branch pickers. Each wraps one daemon RPC or one pure Rove helper. The client
 * never supplies a directory to open, a path to execute or a command line:
 * Scratch is always `$HOME`, a typed path is only listed or validated.
 */

import { realpathSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { extname, join, sep } from "node:path"
import { updateStateFile } from "@sma1lboy/rove/src/state/store.ts"
import { terminalTabsKey } from "@sma1lboy/rove/src/tui-react/workspace/terminal-tabs-persist.ts"
import {
  expandHome,
  filterSubdirs,
  listSubdirs,
  splitPathForDirSuggest,
  stripTrailingSlash,
} from "@sma1lboy/rove/src/tui/lib/path-helpers.ts"
import {
  type CIFailingCheck,
  type CIFailingChecksRead,
  buildCIPromptForWorktree,
} from "@sma1lboy/rove/src/tui/ops/ci-prompt.ts"
import { openExternally } from "@sma1lboy/rove/src/tui/panes/filetree/open-external.ts"
import type { TabsState } from "@sma1lboy/rove/src/tui/workspace/terminal-tab-shapes.ts"
import { moveTab } from "@sma1lboy/rove/src/tui/workspace/terminal-tabs-core.ts"
import { BridgeError, optStr } from "../protocol.ts"
import { flag, oneOf, tabId, taskId } from "./args.ts"
import { effortLevel, engineId, model, taskOpDeps } from "./tasks-shared.ts"
import type { Args, OpContext, OpTable } from "./types.ts"

/** More names than a picker can show; the client filters the rest by typing. */
const SUBDIR_CAP = 200
const PATH_MAX = 1000

export interface TaskOpsDeps {
  homeDir(): string
  buildCIPrompt: typeof buildCIPromptForWorktree
  /** Swap a tab with its neighbour in the persisted strip order; false at an edge or for an unknown tab. */
  reorderTab(taskId: string, tabId: string, delta: -1 | 1): boolean
  /** The Mac's own opener (`open` / `xdg-open`) on an absolute path; fire and forget. */
  openExternal(absPath: string): void
  /** Canonical path (symlinks resolved), or null when it does not exist. */
  canonical(path: string): string | null
  /** Executable bit set, or not a regular file. */
  runnable(path: string): boolean
}

function reorderPersistedTab(taskId: string, tab: string, delta: -1 | 1): boolean {
  let moved = false
  updateStateFile((store) => {
    const state = store[terminalTabsKey(taskId)] as TabsState | undefined
    if (!state || !Array.isArray(state.tabs)) return false
    const next = moveTab(state, tab, delta)
    if (next === state) return false
    store[terminalTabsKey(taskId)] = next
    moved = true
    return undefined
  })
  return moved
}

function canonical(path: string): string | null {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

function runnable(path: string): boolean {
  const info = statSync(path)
  return !info.isFile() || (info.mode & 0o111) !== 0
}

/** What `o` hands to the OS: media and documents, never anything the OS would run or install. */
const OPENABLE = new Set(
  "pdf png jpg jpeg gif webp bmp tif tiff heic svg ico mp3 wav m4a aac flac ogg mp4 m4v mov webm mkv avi ttf otf".split(
    " ",
  ),
)

const realDeps: TaskOpsDeps = {
  openExternal: openExternally,
  canonical,
  runnable,
  homeDir: homedir,
  buildCIPrompt: buildCIPromptForWorktree,
  reorderTab: reorderPersistedTab,
}

/** A typed path as the dialog holds it: absolute or `~`-led, never relative to the bridge's cwd. */
function typedPath(args: Args, name: string): string {
  const v = args[name]
  if (typeof v !== "string" || v.length > PATH_MAX || v.includes("\0")) {
    throw new BridgeError("BAD_ARGS", `${name} must be a path`)
  }
  const trimmed = v.trim()
  if (!(trimmed.startsWith("/") || trimmed.startsWith("~"))) {
    throw new BridgeError("BAD_ARGS", `${name} must be absolute or start with ~`)
  }
  return trimmed
}

/** `""` clears a pinned value (the daemon's wire spelling); anything else must pass `check`. */
function clearable(args: Args, name: string, check: (a: Args, n: string) => string): string | undefined {
  const v = args[name]
  if (v === undefined || v === null) return undefined
  return v === "" ? "" : check(args, name)
}

async function worktreeAndBranch(ctx: OpContext, id: string) {
  const res = await ctx.api.verb<{
    task: { worktreePath?: string; branch?: string; prStatus?: { number?: number } }
  }>("get-task", [flag("task-id", id)])
  const { worktreePath, branch, prStatus } = res.task
  if (!worktreePath) throw new BridgeError("NO_WORKTREE", `task ${id} has no worktree yet`)
  return { worktree: worktreePath, branch: branch ?? "", prNumber: prStatus?.number }
}

export function taskOps(deps: TaskOpsDeps = realDeps): OpTable {
  return {
    "task.landPreflight": {
      kind: "read",
      destructive: false,
      wraps: "rpc task.landPreflight",
      async run(a, { api }) {
        const res = await api.rpc<{ result: unknown }>("task.landPreflight", { taskId: taskId(a) })
        return res.result
      },
    },

    "task.syncBase": {
      kind: "write",
      destructive: false,
      wraps: "rpc task.syncBase (merge base into the worktree)",
      async run(a, { api }) {
        const res = await api.rpc<{ result: { baseRef: string; alreadyCurrent: boolean } }>("task.syncBase", {
          taskId: taskId(a),
        })
        return { baseRef: res.result.baseRef, alreadyCurrent: res.result.alreadyCurrent === true }
      },
    },

    "task.fixChecks": {
      kind: "write",
      destructive: false,
      wraps: "rpc pr.failingChecks + buildCIPromptForWorktree + rove api send --plain",
      async run(a, ctx) {
        const id = taskId(a)
        const { worktree, branch, prNumber } = await worktreeAndBranch(ctx, id)
        const read = await ctx.api.rpc<{
          checks?: readonly CIFailingCheck[]
          totalFailing?: number
          unavailable?: { reason: string; detail: string }
        }>("pr.failingChecks", { taskId: id })
        const checks = read.checks ?? []
        // `gh` never answered vs nothing red: the TUI tells them apart in two toasts.
        if (read.unavailable) return { outcome: "unavailable", detail: read.unavailable.detail }
        if (checks.length === 0) return { outcome: "none" }
        const state: CIFailingChecksRead = { checks, totalFailing: read.totalFailing ?? checks.length }
        const prompt = await deps.buildCIPrompt(worktree, {
          branch: branch || "HEAD",
          ...(prNumber === undefined ? {} : { prNumber }),
          ...state,
        })
        const argv = [flag("task-id", id), "--plain", flag("prompt", prompt)]
        if (a.tabId !== undefined && a.tabId !== null) argv.push(flag("tab", tabId(a)))
        await ctx.api.verb("send", argv)
        return { outcome: "sent" }
      },
    },

    "task.openScratch": {
      kind: "write",
      destructive: false,
      wraps: "rpc task.openDir {dir: $HOME, scratch: true}",
      async run(a, ctx) {
        const vendor = optStr(a, "engine") === undefined ? undefined : await engineId(a, "engine", ctx)
        const res = await ctx.api.rpc<{ taskId: string }>("task.openDir", {
          dir: deps.homeDir(),
          scratch: true,
          ...(vendor ? { vendor } : {}),
        })
        return { taskId: res.taskId }
      },
    },

    "task.setEngine": {
      kind: "write",
      destructive: false,
      wraps: "rpc task.setVendor (engine + reasoning level + model; '' clears)",
      async run(a, ctx) {
        const id = taskId(a)
        const vendor = await engineId(a, "engine", ctx)
        const effort = clearable(a, "effort", (args, n) => effortLevel(args, n))
        const mdl = clearable(a, "model", (args, n) => model(args, n))
        await ctx.api.rpc("task.setVendor", {
          taskId: id,
          vendor,
          ...(effort === undefined ? {} : { effort }),
          ...(mdl === undefined ? {} : { model: mdl }),
        })
        return {}
      },
    },

    "tab.move": {
      kind: "write",
      destructive: false,
      wraps: "state.json terminalTabs.<task> order (moveTab)",
      async run(a) {
        const direction = oneOf(a, "direction", ["up", "down"] as const)
        return { moved: deps.reorderTab(taskId(a), tabId(a), direction === "up" ? -1 : 1) }
      },
    },

    "file.openExternal": {
      kind: "write",
      destructive: false,
      wraps: "helper openExternally (the Mac's `open`) on a media/document file inside the task's worktree",
      async run(a, { api }) {
        const rel = optStr(a, "path") ?? ""
        if (
          !rel ||
          rel.length > PATH_MAX ||
          rel.startsWith("/") ||
          rel.includes("\0") ||
          rel.split(/[\\/]/).includes("..")
        ) {
          throw new BridgeError("BAD_ARGS", "path must be relative to the worktree")
        }
        const got = await api.verb<{ task: { worktreePath?: string | null } }>("get-task", [flag("task-id", taskId(a))])
        const worktree = got.task.worktreePath
        if (!worktree) throw new BridgeError("NO_WORKTREE", "this task has no worktree yet")
        const root = deps.canonical(worktree)
        const abs = deps.canonical(join(worktree, rel))
        if (!root || !abs) throw new BridgeError("NOT_FOUND", `${rel} does not exist`)
        // A symlink may not carry the open out of the worktree.
        if (abs !== root && !abs.startsWith(root.endsWith(sep) ? root : root + sep)) {
          throw new BridgeError("BAD_ARGS", "path is outside the worktree")
        }
        if (!OPENABLE.has(extname(abs).slice(1).toLowerCase()) || deps.runnable(abs)) {
          throw new BridgeError("NOT_OPENABLE", "only images, audio, video, PDFs and fonts open in the system app")
        }
        deps.openExternal(abs)
        return {}
      },
    },

    "fs.subdirs": {
      kind: "read",
      destructive: false,
      wraps: "helpers splitPathForDirSuggest + listSubdirs + filterSubdirs",
      async run(a) {
        const split = splitPathForDirSuggest(typedPath(a, "path"))
        const names = filterSubdirs(listSubdirs(split.base), split.filter)
        return { base: split.base, home: deps.homeDir(), names: names.slice(0, SUBDIR_CAP) }
      },
    },

    "repo.probe": {
      kind: "read",
      destructive: false,
      wraps: "helpers validateRepoPath + listLocalBranches + getCurrentBranch (+ rpc worktree.discoverAdoptable)",
      async run(a, { api }) {
        const repo = stripTrailingSlash(expandHome(typedPath(a, "path")))
        const reason = taskOpDeps.validateRepoPath(repo)
        if (reason) return { ok: false, repo, reason }
        const out: Record<string, unknown> = {
          ok: true,
          repo,
          branches: taskOpDeps.listLocalBranches(repo),
          current: taskOpDeps.getCurrentBranch(repo),
        }
        if (a.adoptable === true) {
          const found = await api.rpc<{ worktrees?: readonly unknown[] }>("worktree.discoverAdoptable", { repo })
          out.worktrees = found.worktrees ?? []
        }
        return out
      },
    },
  }
}

export const TASKOPS_OPS: OpTable = taskOps()
