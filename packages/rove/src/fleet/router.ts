/**
 * `fleet.router`: an endpoint that reads the prompt and names the node for
 * `--machine auto`. Same rules as the auto-routing classifier: off unless set,
 * never blocks a dispatch (any failure is "no pick" and the built-in matcher
 * decides), and an answer naming a node it was not offered is ignored.
 *
 *   POST { prompt, nodes: [{ alias, tags, description, load }] }
 *   →    { node: "<alias>" }
 */

import type { NodeStatus } from "./node-status.ts"
import { nodeLoad } from "./schedule.ts"

/** The first paragraphs decide where a task belongs. */
const PROMPT_LIMIT = 2000

export async function askRouter(args: {
  readonly url: string
  readonly timeoutMs: number
  readonly prompt: string
  readonly nodes: readonly { readonly alias: string; readonly status: NodeStatus }[]
  readonly fetchImpl?: typeof fetch
}): Promise<string | undefined> {
  const body = {
    prompt: args.prompt.slice(0, PROMPT_LIMIT),
    nodes: args.nodes.map(({ alias, status }) => ({
      alias,
      tags: status.tags,
      description: status.description,
      load: Number(nodeLoad(status).toFixed(2)),
    })),
  }
  try {
    const res = await (args.fetchImpl ?? fetch)(args.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(args.timeoutMs),
    })
    if (!res.ok) return undefined
    const answer: unknown = await res.json()
    const node = typeof answer === "object" && answer !== null ? (answer as { node?: unknown }).node : undefined
    return typeof node === "string" && args.nodes.some((n) => n.alias === node) ? node : undefined
  } catch {
    return undefined
  }
}
