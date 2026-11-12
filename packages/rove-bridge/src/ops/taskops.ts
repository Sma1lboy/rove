/**
 * Task-row verbs the TUI sidebar menu and new-task dialog need beyond the basic
 * task ops: land preflight, sync with base, fix failing checks, Scratch, engine
 * change with model/effort, and the two reads behind the dialog's path and
 * branch pickers. Each wraps one daemon RPC or one pure Rove helper. The client
 * never supplies a directory to open, a path to execute or a command line:
 * Scratch is always `$HOME`, a typed path is only listed or validated.
 */

import { existsSync, realpathSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { extname, join, sep } from "node:path"
import type { SharedTabs, TabOp } from "@sma1lboy/rove-daemon/daemon/tabs-ops"
import {
  expandHome,
  filterSubdirs,
  listSubdirs,
  splitPathForDirSuggest,
  stripTrailingSlash,
} from "@sma1lboy/rove/src/tui/lib/path-helpers.ts"
import { type WorktreeOpener, detectWorktreeOpener, openWorktree } from "@sma1lboy/rove/src/tui/lib/worktree-opener.ts"
import {
  type CIFailingCheck,
  type CIFailingChecksRead,
  buildCIPromptForWorktree,
} from "@sma1lboy/rove/src/tui/ops/ci-prompt.ts"
import { buildPRPrompt } from "@sma1lboy/rove/src/tui/ops/pr-prompt.ts"
import { openExternally } from "@sma1lboy/rove/src/tui/panes/filetree/open-external.ts"
import type { TabsState } from "@sma1lboy/rove/src/tui/workspace/terminal-tab-shapes.ts"
import { moveTab } from "@sma1lboy/rove/src/tui/workspace/terminal-tabs-core.ts"
import { BridgeError, optStr } from "../protocol.ts"
import { flag, isAbsPath, oneOf, tabId, taskId } from "./args.ts"
import { effortLevel, engineId, model, taskOpDeps } from "./tasks-shared.ts"
import type { Args, BridgeApi, OpContext, OpTable } from "./types.ts"

/** More names than a picker can show; the client filters the rest by typing. */
const SUBDIR_CAP = 200
const PATH_MAX = 1000

export interface TaskOpsDeps {
  homeDir(): string
  buildCIPrompt: typeof buildCIPromptForWorktree
  /** The create-PR instruction for a worktree (the repo's template when it has one). */
  prPrompt(worktree: string): Promise<string>
  /** Swap a tab with its neighbour in the daemon's strip order; false at an edge or for an unknown tab. */
  reorderTab(taskId: string, tabId: string, delta: -1 | 1, api: BridgeApi): Promise<boolean>
  /** The Mac's own opener (`open` / `xdg-open`) on an absolute path; fire and forget. */
  openExternal(absPath: string): void
  /** The Mac's editor for `o`: the `ROVE_OPEN_EDITOR` override, else an installed editor CLI or app; null when none. */
  detectOpener(): WorktreeOpener | null
  /** Spawn the editor on a directory, detached; false when it would not start. */
  openWorktree(path: string, opener: WorktreeOpener): boolean
  /** The path exists on the Mac. */
  exists(path: string): boolean
  /** Canonical path (symlinks resolved), or null when it does not exist. */
  canonical(path: string): string | null
  /** Executable bit set, or not a regular file. */
  runnable(path: string): boolean
}

/**
 * The TUI's `moveTab` on the daemon's current tabs (`tabs.get`), sent as one
 * `order` op: the daemon owns the tabs and publishes the new order on
 * `tabs.changed`. Ids only, so a tab another client opened in between keeps
 * its place after the ones named.
 */
export async function reorderDaemonTab(taskId: string, tab: string, delta: -1 | 1, api: BridgeApi): Promise<boolean> {
  const { state } = await api.rpc<{ state: SharedTabs | null }>("tabs.get", { taskId })
  if (!state || !Array.isArray(state.tabs)) return false
  // `moveTab` reads only the order; `activeId` is no client's here.
  const current = { ...state, activeId: state.activeId ?? "" } as unknown as TabsState
  const next = moveTab(current, tab, delta)
  if (next === current) return false
  const ops: TabOp[] = [{ op: "order", ids: next.tabs.map((t) => t.id) }]
  await api.rpc("tabs.apply", { taskId, ops })
  return true
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
  detectOpener: detectWorktreeOpener,
  openWorktree,
  exists: existsSync,
  canonical,
  runnable,
  homeDir: homedir,
  buildCIPrompt: buildCIPromptForWorktree,
  prPrompt: buildPRPrompt,
  reorderTab: reorderDaemonTab,
}

/** A typed path as the dialog holds it: absolute or `~`-led, never relative to the bridge's cwd. */
function typedPath(args: Args, name: string): string {
  const v = args[name]
  if (typeof v !== "string" || v.length > PATH_MAX || v.includes("\0")) {
    throw new BridgeError("BAD_ARGS", `${name} must be a path`)
  }
  const trimmed = v.trim()
  if (!(isAbsPath(trimmed) || trimmed.startsWith("~"))) {
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
    task: { worktreePath?: string; branch?: string; prStatus?: { number?: number; baseRef?: string } }
  }>("get-task", [flag("task-id", id)])
  const { worktreePath, branch, prStatus } = res.task
  if (!worktreePath) throw new BridgeError("NO_WORKTREE", `task ${id} has no worktree yet`)
  return { worktree: worktreePath, branch: branch ?? "", prNumber: prStatus?.number, baseRef: prStatus?.baseRef }
}

const PR_PROMPT_KINDS = ["commit", "createPR", "fixCI", "conflicts", "comments"] as const

/** One line each: the page types them into an engine's input, where a newline would send. */
function conflictsPrompt(pr: string, base: string): string {
  return `${pr} has merge conflicts with ${base}. Fetch, merge ${base} into this branch, resolve every conflict keeping the intent of both sides, run the project's checks, then commit the merge and push.`
}

function commentsPrompt(pr: string): string {
  return `${pr} has review feedback to address. Read it with \`gh pr view --comments\` and \`gh api repos/{owner}/{repo}/pulls/<number>/comments\`, make a change for each point (reply only where you disagree and say why), run the project's checks, then commit and push.`
}

const COMMIT_PROMPT =
  "Commit the uncommitted changes in this worktree. Review them with `git status` and `git diff`, split them into logical commits when they are unrelated, write each message in the style of this repo's recent `git log`, and do not push."

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
        const res = await api.rpc<{
          result: { baseRef: string; alreadyCurrent: boolean; repos?: readonly { ok: boolean; error?: string }[] }
        }>("task.syncBase", { taskId: taskId(a) })
        // A multi-repo task syncs every repo; surface the first failure like a one-repo conflict.
        const failed = res.result.repos?.find((r) => !r.ok)
        if (failed) throw new Error(failed.error ?? "sync failed")
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

    "task.prompt": {
      kind: "read",
      destructive: false,
      wraps:
        "buildPRPrompt | rpc pr.failingChecks + buildCIPromptForWorktree | fixed text (commit, conflicts, comments); returns the prompt, sends nothing",
      async run(a, ctx) {
        const id = taskId(a)
        const kind = oneOf(a, "kind", PR_PROMPT_KINDS)
        const { worktree, branch, prNumber, baseRef } = await worktreeAndBranch(ctx, id)
        const pr = prNumber === undefined ? "This task's PR" : `PR #${prNumber}`
        if (kind === "createPR") return { outcome: "ok", prompt: await deps.prPrompt(worktree) }
        if (kind === "commit") return { outcome: "ok", prompt: COMMIT_PROMPT }
        if (kind === "conflicts") return { outcome: "ok", prompt: conflictsPrompt(pr, baseRef || "its base branch") }
        if (kind === "comments") return { outcome: "ok", prompt: commentsPrompt(pr) }
        const read = await ctx.api.rpc<{
          checks?: readonly CIFailingCheck[]
          totalFailing?: number
          unavailable?: { reason: string; detail: string }
        }>("pr.failingChecks", { taskId: id })
        const checks = read.checks ?? []
        if (read.unavailable) return { outcome: "unavailable", detail: read.unavailable.detail }
        if (checks.length === 0) return { outcome: "none" }
        const prompt = await deps.buildCIPrompt(worktree, {
          branch: branch || "HEAD",
          ...(prNumber === undefined ? {} : { prNumber }),
          checks,
          totalFailing: read.totalFailing ?? checks.length,
        })
        return { outcome: "ok", prompt }
      },
    },

    "task.openEditor": {
      kind: "write",
      destructive: false,
      wraps: "helpers detectWorktreeOpener + openWorktree (the TUI's `o`) on the task's worktree, via ensure-worktree",
      async run(a, { api }) {
        const id = taskId(a)
        const got = await api.verb<{ task: { worktreePath?: string | null } }>("get-task", [flag("task-id", id)])
        let path = got.task.worktreePath ?? ""
        if (!path || !deps.exists(path)) {
          const made = await api.verb<{ worktreePath?: string }>("ensure-worktree", [flag("task-id", id)])
          path = made.worktreePath ?? ""
        }
        if (!path || !deps.exists(path)) throw new BridgeError("NO_WORKTREE", "this task has no worktree on disk")
        const opener = deps.detectOpener()
        // The TUI's two toasts (no editor / couldn't open) are outcomes, not failures: the client words them.
        if (!opener) return { outcome: "noEditor" }
        if (!deps.openWorktree(path, opener)) return { outcome: "failed", label: opener.label }
        return { outcome: "opened", label: opener.label }
      },
    },

    "task.openScratch": {
      kind: "write",
      destructive: false,
      wraps: "rpc task.openDir {dir: $HOME, scratch: true}",
      async run(a, ctx) {
        const home = deps.homeDir()
        // Scratch remembers its own last engine, keyed by $HOME like any project; `+` reuses it.
        const picked = optStr(a, "engine") === undefined ? undefined : await engineId(a, "engine", ctx)
        const res = await ctx.api.rpc<{ taskId: string }>("task.openDir", {
          dir: home,
          scratch: true,
          vendor: picked ?? taskOpDeps.preferredEngine(home),
        })
        if (picked) taskOpDeps.rememberEngine(home, picked)
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
      wraps: "rpc tabs.apply order (the TUI's moveTab on tabs.get)",
      async run(a, { api }) {
        const direction = oneOf(a, "direction", ["up", "down"] as const)
        return { moved: await deps.reorderTab(taskId(a), tabId(a), direction === "up" ? -1 : 1, api) }
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
        const reason = await taskOpDeps.validateRepoPath(repo)
        // Not a git repo (or no commit yet) but a real folder: it opens in place, without worktrees.
        if (reason && taskOpDeps.isDirectory(repo)) return { ok: true, repo, git: false, branches: [], current: null }
        if (reason) return { ok: false, repo, reason }
        const [branches, current] = await Promise.all([
          taskOpDeps.listLocalBranches(repo),
          taskOpDeps.getCurrentBranch(repo),
        ])
        const out: Record<string, unknown> = { ok: true, repo, branches, current }
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
