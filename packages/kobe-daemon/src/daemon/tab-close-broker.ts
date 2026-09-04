/**
 * Pending exact Terminal Tab closes (`terminalTab.close` -> TUI close path ->
 * `terminalTab.closeReply`). A daemon request waits only when a TUI is
 * attached. The first client that confirms a close settles the request;
 * negative replies leave room for another attached TUI with fresher state.
 */

type Pending = {
  readonly resolve: (closed: boolean) => void
  readonly timer: ReturnType<typeof setTimeout>
}

export class TabCloseBroker {
  private readonly pending = new Map<string, Pending>()

  /** Resolve true on the first confirmed close, false when the wait expires. */
  create(requestId: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        resolve(false)
      }, timeoutMs)
      this.pending.set(requestId, { resolve, timer })
    })
  }

  /** Confirm a close. False acknowledgements do not pre-empt another TUI. */
  settle(requestId: string, closed: boolean): boolean {
    const entry = this.pending.get(requestId)
    if (!entry) return false
    if (!closed) return true
    this.pending.delete(requestId)
    clearTimeout(entry.timer)
    entry.resolve(true)
    return true
  }

  /** Settle every waiter during daemon shutdown. */
  clear(): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.resolve(false)
      this.pending.delete(id)
    }
  }
}
