/**
 * Lark → Rove. Each `im.message.receive_v1` event lark-cli streams is gated
 * (a person, addressing the bot by DM or @, on the allow list), marked "OnIt",
 * and handed to the Lark agent's task as a turn. The agent replies on Lark
 * itself with lark-cli; the bridge never reads its screen. When the agent's
 * turn ends, every message it was handling gets "DONE".
 */

import { agentBrief } from "./brief.ts"
import type { LarkConfig, LarkStore } from "./store.ts"

export interface LarkEvent {
  readonly sender_type?: string
  readonly sender_id?: string
  readonly chat_type?: string
  readonly chat_id?: string
  readonly message_id?: string
  readonly root_id?: string
  readonly content?: string
  readonly mentions?: readonly { readonly id?: string }[]
}

/** The Rove verbs the bridge needs, over the daemon socket. */
export interface LarkOps {
  taskExists(taskId: string): Promise<boolean>
  /** Open `dir` as a pinned directory task named `title`, marked as the `lark` connector's session. */
  openAgentTask(dir: string, title: string): Promise<{ readonly taskId: string }>
  /** A new engine tab in `taskId` whose first message is `prompt`. */
  newConversation(taskId: string, prompt: string): Promise<{ readonly tab: string }>
  send(taskId: string, tab: string, prompt: string): Promise<void>
  taskRunning(taskId: string): Promise<boolean>
}

export interface LarkBridgeDeps {
  readonly ops: LarkOps
  readonly store: LarkStore
  readonly react: (messageId: string, emoji: string) => Promise<unknown>
  readonly log: (message: string) => void
  readonly sleep: (ms: number) => Promise<unknown>
  readonly now: () => number
  readonly cli?: string
}

export const DONE_TIMINGS = { pollMs: 3_000, warmupMs: 30_000, maxMs: 30 * 60_000 }

export function admit(e: LarkEvent, bot: string, allow: readonly string[]): string {
  if (e.sender_type !== "user") return "bot"
  const addressed = e.chat_type === "p2p" || (e.mentions ?? []).some((m) => m.id === bot)
  if (!addressed) return "not addressed"
  if (!e.sender_id || !allow.includes(e.sender_id)) return `not allowed (rove lark allow ${e.sender_id ?? "?"})`
  return "ok"
}

export function eventPrompt(e: LarkEvent): string {
  const where = e.chat_type === "p2p" ? "DM" : `group ${e.chat_id}`
  return `[Lark] ${where} from ${e.sender_id}\nmessage_id=${e.message_id} root_id=${e.root_id || e.message_id}\n\n${e.content ?? ""}`
}

export function createLarkBridge(deps: LarkBridgeDeps, timings = DONE_TIMINGS) {
  const cli = deps.cli ?? "rove"
  let watching: Promise<void> | null = null
  // One message at a time: two arriving together must not both open an agent.
  let queue: Promise<void> = Promise.resolve()

  async function deliver(e: LarkEvent, config: LarkConfig): Promise<string> {
    const state = deps.store.readState()
    const agent = state.agent && (await deps.ops.taskExists(state.agent.taskId)) ? state.agent : undefined
    if (!agent) {
      const { taskId } = await deps.ops.openAgentTask(deps.store.agentDir, "Lark")
      const prompt = `${agentBrief(config.botName, cli)}\nTONE: ${config.tone}\n\n${eventPrompt(e)}`
      const { tab } = await deps.ops.newConversation(taskId, prompt)
      deps.store.writeState({ ...deps.store.readState(), agent: { taskId, tab }, tone: config.tone })
      deps.log(`agent created ${taskId}`)
      return taskId
    }
    const tone = state.tone === config.tone ? "" : `[Lark tone] ${config.tone}\n\n`
    await deps.ops.send(agent.taskId, agent.tab, tone + eventPrompt(e))
    if (tone) deps.store.writeState({ ...deps.store.readState(), tone: config.tone })
    return agent.taskId
  }

  /** "DONE" on every pending message once the agent's turn ends (or never starts, or runs past the ceiling). */
  function watchDone(taskId: string): void {
    watching ??= waitTurnEnd(taskId).finally(() => {
      watching = null
    })
  }

  async function waitTurnEnd(taskId: string): Promise<void> {
    const startedAt = deps.now()
    let seenRunning = false
    while (true) {
      await deps.sleep(timings.pollMs)
      const elapsed = deps.now() - startedAt
      const running = await deps.ops.taskRunning(taskId).catch(() => false)
      if (running) seenRunning = true
      if (elapsed >= timings.maxMs || (!running && (seenRunning || elapsed >= timings.warmupMs))) break
    }
    const { pending } = deps.store.readState()
    deps.store.writeState({ ...deps.store.readState(), pending: [] })
    await Promise.all(pending.map((id) => deps.react(id, "DONE")))
  }

  async function handle(e: LarkEvent, config: LarkConfig): Promise<void> {
    const id = e.message_id
    if (!id) return
    const state = deps.store.readState()
    if (state.seen.includes(id)) return
    deps.store.writeState({ ...state, seen: [...state.seen, id] })
    const allow = config.ownerOpenId ? [config.ownerOpenId, ...config.allow] : config.allow
    const verdict = admit(e, config.botOpenId, allow)
    deps.log(`${id} ${e.chat_type} ${verdict}`)
    if (verdict !== "ok") return
    void deps.react(id, "OnIt")
    try {
      const taskId = await deliver(e, config)
      deps.store.writeState({ ...deps.store.readState(), pending: [...deps.store.readState().pending, id] })
      watchDone(taskId)
    } catch (err) {
      deps.log(`deliver failed: ${err instanceof Error ? err.message : String(err)}`)
      void deps.react(id, "ERROR")
    }
  }

  return {
    /** One line of `lark-cli event consume` output. */
    onLine(line: string): Promise<void> {
      let e: LarkEvent
      try {
        e = JSON.parse(line) as LarkEvent
      } catch {
        return queue
      }
      const config = deps.store.readConfig()
      if (!config) return queue
      queue = queue.then(() => handle(e, config)).catch((err) => deps.log(String(err)))
      return queue
    },
    /** Resolves once no turn is being watched for DONE. */
    idle: (): Promise<void> => watching ?? Promise.resolve(),
  }
}
