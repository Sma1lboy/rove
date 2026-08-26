/**
 * Event hook: read the fired event envelope and toast a one-line summary.
 *
 * Demonstrates pluginEvent(), detail fields (turn usage when present), and
 * the SDK notify() helper that calls back into Rove's CLI.
 */
import { notify, pluginContext, pluginEvent } from "@sma1lboy/rove-plugin-sdk"

interface TurnDetail {
  readonly id?: string
  readonly model?: string
  readonly usage?: {
    readonly input_tokens?: number
    readonly output_tokens?: number
  }
}

const ctx = pluginContext()
const ev = pluginEvent()
if (!ev) {
  console.error("turn-notify: not running inside a Rove event hook")
  process.exit(1)
}

const taskTitle = ev.task?.title ?? ctx.taskTitle ?? "Task"

if (ev.event === "turn.complete") {
  const turn = (ev.detail?.turn ?? undefined) as TurnDetail | undefined
  const usage = turn?.usage
  const bodyParts: string[] = []
  if (turn?.model) bodyParts.push(`model: ${turn.model}`)
  if (usage?.input_tokens != null) bodyParts.push(`in: ${usage.input_tokens}`)
  if (usage?.output_tokens != null) bodyParts.push(`out: ${usage.output_tokens}`)

  const title = `${taskTitle} completed a turn`
  const body = bodyParts.length > 0 ? bodyParts.join(" · ") : undefined
  await notify(title, body)
  console.log(`turn-notify: ${title}${body ? ` — ${body}` : ""}`)
} else if (ev.event === "agent.permission-needed") {
  const title = `${taskTitle} needs permission`
  await notify(title, "Agent is blocked waiting for approval")
  console.log(`turn-notify: ${title}`)
}
