/**
 * What was said in any task's conversations (`sessions.search` → `rove api search`), as the rail
 * shows it under the title matches. Framework-free so the ordering rules can be tested alone.
 */

export interface Hit {
  readonly taskId: string
  readonly title: string
  readonly tabId?: string
  readonly role: "user" | "assistant"
  readonly at: string
  readonly snippet: string
}

export interface Reply {
  readonly matches: readonly Hit[]
  readonly skipped: readonly unknown[]
  readonly truncated: boolean
}

export type HitState =
  | { readonly kind: "idle" }
  | { readonly kind: "searching" }
  | { readonly kind: "done"; readonly query: string; readonly reply: Reply }
  | { readonly kind: "failed"; readonly message: string }

export const MIN_CHARS = 2
export const DEBOUNCE_MS = 300

export interface HitSearch {
  /** Search for `text`; an earlier search still waiting or in flight is dropped. */
  readonly run: (text: string) => void
  /** Drop whatever is pending and stop reporting. */
  readonly stop: () => void
}

export function hitSearch(
  request: (query: string) => Promise<Reply>,
  report: (state: HitState) => void,
  debounceMs = DEBOUNCE_MS,
): HitSearch {
  let turn = 0
  let cancelTimer: (() => void) | undefined
  const stop = () => {
    turn++
    cancelTimer?.()
    cancelTimer = undefined
  }
  return {
    stop,
    run: (text) => {
      stop()
      const q = text.trim()
      if (q.length < MIN_CHARS) {
        report({ kind: "idle" })
        return
      }
      const mine = turn
      const timer = setTimeout(() => {
        report({ kind: "searching" })
        request(q).then(
          (reply) => mine === turn && report({ kind: "done", query: q, reply }),
          (err: unknown) =>
            mine === turn && report({ kind: "failed", message: err instanceof Error ? err.message : String(err) }),
        )
      }, debounceMs)
      cancelTimer = () => clearTimeout(timer)
    },
  }
}
