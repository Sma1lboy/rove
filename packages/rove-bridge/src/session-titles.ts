/**
 * The PTY host's live session titles (OSC 0/2), polled the way the TUI's sidebar polls them
 * (`use-host-sessions.ts`): the host publishes bytes only to attached connections, and `pty.list`
 * is a cheap in-memory read. One shared connection, one request per poll, however many tasks.
 */

/** The slice of a PTY host connection this poller uses (faked in tests). */
export interface PtyListClient {
  request<T = unknown>(name: "pty.list", payload?: unknown): Promise<T>
  close(): void
}

/** Same cadence as the TUI's `use-host-sessions.ts`. */
export const SESSION_TITLES_POLL_MS = 2_000

export class SessionTitles {
  private client: PtyListClient | null = null
  private titles: ReadonlyMap<string, string> = new Map()
  private signature = ""
  private readAt = Number.NEGATIVE_INFINITY
  private inflight: Promise<ReadonlyMap<string, string>> | null = null
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly open: () => PtyListClient,
    private readonly now: () => number = Date.now,
  ) {}

  /** Titles no older than one poll interval; a read older than that asks the host again. */
  async current(): Promise<ReadonlyMap<string, string>> {
    if (this.now() - this.readAt < SESSION_TITLES_POLL_MS) return this.titles
    return this.poll()
  }

  /**
   * Poll while `active()` and call `onChange` when any session's title moved. Idle bridges (no
   * client listening) cost no host traffic.
   */
  watch(active: () => boolean, onChange: () => void, intervalMs = SESSION_TITLES_POLL_MS): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      if (active()) void this.tick().then((moved) => moved && onChange())
    }, intervalMs)
  }

  /** Ask the host now; true when some session's title moved since the last read. */
  async tick(): Promise<boolean> {
    const before = this.signature
    await this.poll()
    return this.signature !== before
  }

  stop(): void {
    clearInterval(this.timer ?? undefined)
    this.timer = null
    this.client?.close()
    this.client = null
  }

  private poll(): Promise<ReadonlyMap<string, string>> {
    this.inflight ??= this.read().finally(() => {
      this.inflight = null
    })
    return this.inflight
  }

  private async read(): Promise<ReadonlyMap<string, string>> {
    const titles = new Map<string, string>()
    try {
      this.client ??= this.open()
      const { sessions = [] } = await this.client.request<{
        sessions?: readonly { key?: string; alive?: boolean; title?: string }[]
      }>("pty.list", {})
      for (const session of sessions) {
        const title = session.title?.trim()
        if (session.alive !== false && typeof session.key === "string" && title) titles.set(session.key, title)
      }
    } catch {
      // No host, or its socket died: no titles now; reconnect on the next poll.
      this.client?.close()
      this.client = null
    }
    this.titles = titles
    this.readAt = this.now()
    this.signature = JSON.stringify([...titles])
    return titles
  }
}
