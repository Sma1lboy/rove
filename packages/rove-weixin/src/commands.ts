/**
 * What a WeChat message can ask Rove to do. Each verb is the phone-sized twin of
 * a `rove api` verb:
 *
 *   status [repo]                 → `context`
 *   send <id> [tab-N] <text>      → `send --task-id <id> [--tab tab-N]`
 *   add <repo> <prompt>           → `add --repo <repo> --prompt <prompt>`
 *   gates                         → `gates` (decisions a task put to its owner)
 *   answer <g-N> <key> [note]     → `gate-answer --gate g-N --option key [--text note]`
 *
 * Tasks are named by the last characters of their id (what `status` prints);
 * repos by their directory name. Everything Rove-side goes through
 * {@link RoveOps}, so routing is tested without a daemon.
 */

import { basename } from "node:path"
import type { Gate } from "@sma1lboy/rove-daemon/daemon/contracts"
import type { ContextPayload } from "@sma1lboy/rove/src/cli/api/context-view.ts"
import { ApiError } from "@sma1lboy/rove/src/cli/api/types.ts"
import { head, renderStatus, shortId } from "./format.ts"
import { answeredReply, parseAnswer, renderGates } from "./gates.ts"
import type { NotifyingRoutine } from "./routines.ts"

export interface TaskRef {
  readonly id: string
  readonly title: string
  readonly repo: string
}

export interface RoveOps {
  /** `repo: null` = every repo. `gatesUnreadable`: the gate read failed, so `gates` is unknown rather than empty. */
  status(repo: string | null): Promise<ContextPayload & { gatesUnreadable?: boolean }>
  tasks(): Promise<readonly TaskRef[]>
  /** Saved projects plus every repo a task lives in. */
  repos(): Promise<readonly string[]>
  send(
    taskId: string,
    tab: string | undefined,
    prompt: string,
  ): Promise<{ readonly tab?: string; readonly started?: boolean }>
  add(repo: string, prompt: string): Promise<{ readonly taskId: string }>
  /** Open decision gates. */
  gates(): Promise<readonly Gate[]>
  /** `by: "weixin"`; `delivered` = the engine received it now. */
  answerGate(gateId: string, answer: { option?: string; text?: string }): Promise<{ readonly delivered: boolean }>
  /** Dismiss a `report_missing` row (`attention-dismiss --delivery`); throws DELIVERY_NOT_FOUND for an unknown id. */
  clearReport(deliveryId: string): Promise<void>
  /** Routines created with `--notify`, each with its run history. */
  notifyingRoutineRuns(): Promise<readonly NotifyingRoutine[]>
}

/** The agent free text goes to (`rove weixin agent <task-id> [tab-N]`). */
export interface AgentBinding {
  readonly taskId: string
  readonly tab?: string
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
  "gates — open decisions waiting on you",
  "answer g-12 <key> [note] — answer one",
  "answer g-12 - <text> — free-text answer",
  "clear d-41 — dismiss an unreported-tick flag (status lists them)",
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

/** First words {@link handleCommand} answers; anything else is free text. */
const COMMAND_WORDS = new Set([
  "",
  "help",
  "h",
  "?",
  "帮助",
  "status",
  "s",
  "ls",
  "状态",
  "send",
  "add",
  "new",
  "gates",
  "decisions",
  "决定",
  "answer",
  "回答",
  "clear",
  "清除",
])

/**
 * The prompt the bound agent sees. It names the reply verb because the bridge
 * does not read the agent's output: the agent answers by pushing.
 */
export function agentPrompt(text: string, cli: string): string {
  return `[WeChat] ${text}\n\n(From the owner on WeChat. Reply there with \`${cli} weixin send "<reply>"\` — or --file for long text — in the language they wrote in.)`
}

/**
 * One inbound message → the reply text, or "" when the bound agent will
 * answer by itself. Commands keep their meaning with an agent bound; only
 * free text goes to it.
 */
export async function handleInbound(
  text: string,
  ops: RoveOps,
  agent: AgentBinding | null,
  cli = "rove",
): Promise<string> {
  const [word] = head(text)
  if (!agent || COMMAND_WORDS.has(word.toLowerCase())) return await handleCommand(text, ops, agent !== null)
  try {
    const result = await ops.send(agent.taskId, agent.tab, agentPrompt(text.trim(), cli))
    return result.started ? "Agent was not running — started it; it will reply here." : ""
  } catch (err) {
    return `${failure(err)}\nThe bound agent did not get your message (${CLI_HINT}).`
  }
}

const CLI_HINT = "rebind with `rove weixin agent <task-id>` on the Rove machine"

/** One inbound message → the reply text. Never throws: a failure is a reply. */
export async function handleCommand(text: string, ops: RoveOps, agentBound = false): Promise<string> {
  const [word, rest] = head(text)
  try {
    switch (word.toLowerCase()) {
      case "":
      case "help":
      case "h":
      case "?":
      case "帮助":
        return agentBound ? `${HELP_TEXT}\nAnything else goes to your bound agent.` : HELP_TEXT

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

      case "gates":
      case "decisions":
      case "决定": {
        const [gates, tasks] = await Promise.all([ops.gates(), ops.tasks()])
        return renderGates(gates, new Map(tasks.map((t) => [t.id, t.title])))
      }

      case "answer":
      case "回答": {
        const parsed = parseAnswer(rest, await ops.gates())
        if (!parsed.ok) return parsed.reply
        const { gate, option, text } = parsed.answer
        const { delivered } = await ops.answerGate(gate.id, {
          ...(option ? { option } : {}),
          ...(text ? { text } : {}),
        })
        return answeredReply(parsed.answer, delivered)
      }

      case "clear":
      case "清除": {
        const [ref] = head(rest)
        if (!ref || !/^d-\d+$/i.test(ref)) return "Usage: clear d-N — the delivery id from status"
        await ops.clearReport(ref.toLowerCase())
        return `Cleared ${ref.toLowerCase()}. That task can be ticked again.`
      }

      default:
        return `Unknown command "${word}".\n${HELP_TEXT}\nTo chat in plain text, bind an agent: \`rove weixin agent <task-id>\` on the Rove machine.`
    }
  } catch (err) {
    return failure(err)
  }
}
