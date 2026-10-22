/**
 * The WeChat agent: a personal assistant on the owner's own coding harness,
 * reached by plain WeChat text. It is one `kind: "dir"` task in its own
 * directory, so the sidebar shows it as a project of its own. Each
 * conversation is an engine tab of that task; `/new` opens the next one and
 * the old tabs stay as the conversation history.
 *
 * `rove weixin agent <task-id> [tab-N]` points it at an existing task instead.
 */

import { mkdirSync } from "node:fs"
import type { AgentBinding, RoveOps } from "./commands.ts"
import type { WeixinAgentState } from "./store.ts"

export const AGENT_TITLE = "WeChat"

/** The first message of every conversation: who the agent is and how it answers. */
export function agentBrief(cli: string): string {
  return [
    "You are the owner's personal assistant, reached from WeChat through Rove. Each message they send arrives here prefixed with `[WeChat]`.",
    `The bridge does not read this screen: answer every message with \`${cli} weixin send "<reply>"\` (\`--file <path>\` for long text), short and conclusion-first for a phone, in the language they wrote in.`,
    `You can do anything they could from a shell on this machine. For Rove itself use the rove skill and \`${cli} api\` (\`${cli} api context\` for what is running and what needs them, \`${cli} api add\` to start a task, \`${cli} api send\` to steer one).`,
    "Ask on WeChat before anything irreversible or outward-facing: merging, publishing, deleting, messaging other people.",
    "This tab is one conversation; the owner starts a fresh one with /new.",
  ].join("\n")
}

/** What a forwarded message looks like to the agent. */
export function agentPrompt(text: string): string {
  return `[WeChat] ${text}`
}

export interface AgentControl {
  /** The live conversation, creating the agent (and its first conversation) when there is none. */
  current(firstMessage?: string): Promise<{ readonly agent: WeixinAgentState; readonly created: boolean }>
  /** Open a new conversation; earlier ones stay as tabs of the same task. */
  startNew(firstMessage?: string): Promise<WeixinAgentState>
}

export interface AgentControlDeps {
  readonly ops: RoveOps
  /** The agent's working directory, created on first use. */
  readonly dir: string
  /** `rove weixin agent <task-id> [tab]`: an existing task to use instead. */
  readonly override: () => AgentBinding | null
  readonly read: () => WeixinAgentState | undefined
  readonly write: (agent: WeixinAgentState) => void
  readonly now: () => number
  readonly cli?: string
}

export function createAgentControl(deps: AgentControlDeps): AgentControl {
  const cli = deps.cli ?? "rove"

  async function open(taskId: string, firstMessage?: string): Promise<WeixinAgentState> {
    const previous = deps.read()
    const prompt = firstMessage ? `${agentBrief(cli)}\n\n${agentPrompt(firstMessage)}` : agentBrief(cli)
    const { tab } = await deps.ops.newConversation(taskId, prompt)
    const kept = previous?.taskId === taskId ? previous.conversations : []
    const agent = { taskId, tab, conversations: [...kept, { tab, startedAt: deps.now() }] }
    deps.write(agent)
    return agent
  }

  async function resolveTask(): Promise<{ taskId: string; existing?: WeixinAgentState }> {
    const override = deps.override()
    const stored = deps.read()
    if (override) {
      if (stored?.taskId === override.taskId) return { taskId: override.taskId, existing: stored }
      if (override.tab) {
        const adopted = {
          taskId: override.taskId,
          tab: override.tab,
          conversations: [{ tab: override.tab, startedAt: deps.now() }],
        }
        deps.write(adopted)
        return { taskId: override.taskId, existing: adopted }
      }
      return { taskId: override.taskId }
    }
    const live = stored && (await deps.ops.tasks()).some((t) => t.id === stored.taskId)
    if (stored && live) return { taskId: stored.taskId, existing: stored }
    mkdirSync(deps.dir, { recursive: true, mode: 0o700 })
    return { taskId: (await deps.ops.openAgentTask(deps.dir, AGENT_TITLE)).taskId }
  }

  return {
    async current(firstMessage) {
      const { taskId, existing } = await resolveTask()
      if (existing) return { agent: existing, created: false }
      return { agent: await open(taskId, firstMessage), created: true }
    },
    async startNew(firstMessage) {
      const { taskId } = await resolveTask()
      return await open(taskId, firstMessage)
    },
  }
}
