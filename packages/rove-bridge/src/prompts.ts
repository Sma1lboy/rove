/** Longer than the daemon's longest prompt timeout (600s): past this a replay is no longer a question. */
export const STALE_PROMPT_MS = 600_000

/** A plugin's `rove api prompt` question, as the daemon's `ui.prompt` channel carries it. */
export interface Prompt {
  readonly promptId: string
  readonly title: string
  readonly placeholder?: string
  readonly initial?: string
  /** Publish time, ms epoch. */
  readonly at: number
}

/**
 * Fans each new `ui.prompt` out to every connected client once. The daemon replays its last event
 * on every reconnect, so a prompt id already sent, or one too old to still be waiting, is dropped.
 * A client that connects later never sees an earlier prompt: the first answer wins anyway.
 */
export class PromptFeed {
  private readonly listeners = new Set<(prompt: Prompt) => void>()
  private readonly seen = new Set<string>()

  constructor(private readonly now: () => number = Date.now) {}

  push(prompt: Prompt | null | undefined): void {
    if (!prompt || typeof prompt.promptId !== "string" || typeof prompt.title !== "string") return
    if (typeof prompt.at !== "number" || this.now() - prompt.at > STALE_PROMPT_MS) return
    if (this.seen.has(prompt.promptId)) return
    this.seen.add(prompt.promptId)
    const { promptId, title, placeholder, initial, at } = prompt
    const clean: Prompt = {
      promptId,
      title,
      at,
      ...(typeof placeholder === "string" ? { placeholder } : {}),
      ...(typeof initial === "string" ? { initial } : {}),
    }
    for (const listener of this.listeners) listener(clean)
  }

  subscribe(listener: (prompt: Prompt) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
