/**
 * What a WeChat message can ask Rove to do. Three verbs, each the phone-sized
 * twin of a `rove api` verb:
 *
 *   status [repo]                 → `context`
 *   send <id> [tab-N] <text>      → `send --task-id <id> [--tab tab-N]`
 *   add <repo> <prompt>           → `add --repo <repo> --prompt <prompt>`
 *
 * Tasks are named by the last characters of their id (what `status` prints);
 * repos by their directory name. Everything Rove-side goes through
 * {@link RoveOps}, so routing is tested without a daemon.
 */

import { basename } from "node:path"
import type { ContextPayload } from "@sma1lboy/rove/src/cli/api/context-view.ts"
import { ApiError } from "@sma1lboy/rove/src/cli/api/types.ts"
import { renderStatus, shortId } from "./format.ts"

export interface TaskRef {
  readonly id: string
  readonly title: string
  readonly repo: string
}

export interface RoveOps {
  /** `repo: null` = every repo. */
  status(repo: string | null): Promise<ContextPayload>
  tasks(): Promise<readonly TaskRef[]>
  /** Saved projects plus every repo a task lives in. */
  repos(): Promise<readonly string[]>
  send(
    taskId: string,
    tab: string | undefined,
    prompt: string,
  ): Promise<{ readonly tab?: string; readonly started?: boolean }>
  add(repo: string, prompt: string): Promise<{ readonly taskId: string }>
}

/** Fewer characters than this matches too many ids to be a reference. */
const MIN_ID_CHARS = 4
const TAB_RE = /^tab-\d+$/

export const HELP_TEXT = [
  "Rove commands:",
  "status — what needs you, what's running",
  "status <repo> — one repo only",
  "send <id> <text> — message a task's agent",
  "send <id> tab-2 <text> — a specific tab",
  "add <repo> <prompt> — start a new task",
  "<id> is the 6-char code from status.",
].join("\n")

type Resolved<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reply: string }

function resolveTask(tasks: readonly TaskRef[], ref: string): Resolved<TaskRef> {
  const needle = ref.toLowerCase()
  const exact = tasks.find((t) => t.id.toLowerCase() === needle)
  if (exact) return { ok: true, value: exact }
  if (needle.length < MIN_ID_CHARS)
    return { ok: false, reply: `"${ref}" is too short — use the 6-char code from status.` }
  const hits = tasks.filter((t) => t.id.toLowerCase().endsWith(needle))
  if (hits.length === 1 && hits[0]) return { ok: true, value: hits[0] }
  if (hits.length === 0) return { ok: false, reply: `No task ending in "${ref}". Send "status" for the list.` }
  return {
    ok: false,
    reply: [`"${ref}" matches ${hits.length} tasks:`, ...hits.slice(0, 5).map((t) => `• ${t.id} ${t.title}`)].join(
      "\n",
    ),
  }
}

function resolveRepo(repos: readonly string[], ref: string): Resolved<string> {
  const unique = [...new Set(repos)]
  const exact = unique.find((r) => r === ref)
  if (exact) return { ok: true, value: exact }
  const hits = unique.filter((r) => basename(r).toLowerCase() === ref.toLowerCase())
  if (hits.length === 1 && hits[0]) return { ok: true, value: hits[0] }
  const names = unique.map((r) => basename(r)).sort()
  if (hits.length === 0)
    return {
      ok: false,
      reply: names.length > 0 ? `No repo "${ref}". Known: ${names.join(", ")}` : `No repo "${ref}" — none saved yet.`,
    }
  return { ok: false, reply: [`"${ref}" names ${hits.length} repos; use the full path:`, ...hits].join("\n") }
}

/** `Failed (CODE): message` from an ApiError, or the message alone. */
function failure(err: unknown): string {
  if (err instanceof ApiError) return `Failed (${err.code}): ${err.message}`
  return `Failed: ${err instanceof Error ? err.message : String(err)}`
}

/** Split off the first whitespace-delimited word. */
function head(text: string): [string, string] {
  const match = /^(\S+)\s*([\s\S]*)$/.exec(text.trim())
  return match ? [match[1] ?? "", match[2] ?? ""] : ["", ""]
}

/** One inbound message → the reply text. Never throws: a failure is a reply. */
export async function handleCommand(text: string, ops: RoveOps): Promise<string> {
  const [word, rest] = head(text)
  try {
    switch (word.toLowerCase()) {
      case "":
      case "help":
      case "h":
      case "?":
      case "帮助":
        return HELP_TEXT

      case "status":
      case "s":
      case "ls":
      case "状态": {
        if (!rest.trim()) return renderStatus(await ops.status(null))
        const repo = resolveRepo(await ops.repos(), rest.trim())
        return repo.ok ? `${basename(repo.value)}: ${renderStatus(await ops.status(repo.value))}` : repo.reply
      }

      case "send": {
        const [ref, afterRef] = head(rest)
        let [tab, prompt] = head(afterRef)
        if (!TAB_RE.test(tab)) {
          prompt = afterRef
          tab = ""
        }
        if (!ref || !prompt.trim()) return "Usage: send <id> [tab-N] <text>"
        const task = resolveTask(await ops.tasks(), ref)
        if (!task.ok) return task.reply
        const result = await ops.send(task.value.id, tab || undefined, prompt.trim())
        const where = result.tab ?? tab
        return `Sent to ${shortId(task.value.id)} ${task.value.title}${where ? ` (${where})` : ""}${
          result.started ? " — started a new engine" : ""
        }.`
      }

      case "add":
      case "new": {
        const [repoRef, prompt] = head(rest)
        if (!repoRef || !prompt.trim()) return "Usage: add <repo> <prompt>"
        const repo = resolveRepo(await ops.repos(), repoRef)
        if (!repo.ok) return repo.reply
        const { taskId } = await ops.add(repo.value, prompt.trim())
        return `Started task ${shortId(taskId)} in ${basename(repo.value)}. I'll message you when it needs you.`
      }

      default:
        return `Unknown command "${word}".\n${HELP_TEXT}`
    }
  } catch (err) {
    return failure(err)
  }
}
