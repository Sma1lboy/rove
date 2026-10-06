/** Replays older than this are reconnect echoes of the daemon's last notice, not news. */
export const STALE_NOTICE_MS = 10_000

/** A `rove api notify` toast, as the daemon's `notice.event` channel carries it. */
export interface Notice {
  readonly title: string
  readonly body?: string
  readonly kind: string
  readonly taskId?: string
  readonly source?: string
  /** Publish time, ms epoch; also the dedupe key. */
  readonly at: number
}

/**
 * Fans each fresh `notice.event` out to every connected phone once. The daemon replays its
 * latest notice to a new subscriber and re-delivers on reconnect, so a notice is dropped when
 * its `at` was already seen or is older than {@link STALE_NOTICE_MS}.
 */
export class NoticeFeed {
  private readonly listeners = new Set<(notice: Notice) => void>()
  private lastAt = 0

  constructor(private readonly now: () => number = Date.now) {}

  push(notice: Notice | null | undefined): void {
    if (!notice || typeof notice.title !== "string" || typeof notice.at !== "number") return
    if (notice.at <= this.lastAt) return
    this.lastAt = notice.at
    if (this.now() - notice.at > STALE_NOTICE_MS) return
    const { title, body, kind, taskId, source, at } = notice
    const clean: Notice = {
      title,
      kind: typeof kind === "string" ? kind : "done",
      at,
      ...(body ? { body } : {}),
      ...(taskId ? { taskId } : {}),
      ...(source ? { source } : {}),
    }
    for (const listener of this.listeners) listener(clean)
  }

  subscribe(listener: (notice: Notice) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
