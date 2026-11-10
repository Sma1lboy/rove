/** What the command palette adds to its commands: tasks by title (the rail's fuzzy match) and what was said in any conversation. */

import { useEffect, useMemo, useRef, useState } from "react"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator"
import { type SearchResult, searchTasks } from "../../engine/session-search"
import { fuzzyMatch } from "../../tui/panes/sidebar/fuzzy"
import type { Task } from "../../types/task"

export const MIN_CHARS = 2
export const DEBOUNCE_MS = 300
const LIMIT = 30

/** The host's tasks and the way into one; the palette lists commands only without it. */
export interface PaletteSearch {
  readonly orchestrator: RemoteOrchestrator
  readonly tasks: readonly Task[]
  readonly openTask: (taskId: string, tabId?: string) => void
  /** Wait after the last keystroke before searching conversations. */
  readonly debounceMs?: number
}

export type SaidState =
  | { readonly kind: "idle" }
  | { readonly kind: "searching" }
  | { readonly kind: "done"; readonly result: SearchResult }
  | { readonly kind: "failed"; readonly reason: string }

export function matchingTasks(tasks: readonly Task[], query: string): readonly Task[] {
  const q = query.trim()
  if (!q) return []
  // A scratch shell shows no title, so its title must not match.
  return tasks.filter((task) => task.kind !== "dir" && fuzzyMatch(q, task.title))
}

/** Conversation hits for `query`; a reply for an older query never lands. */
export function useSaid(search: PaletteSearch | undefined, query: string): SaidState {
  const [state, setState] = useState<SaidState>({ kind: "idle" })
  const seq = useRef(0)
  const orchestrator = search?.orchestrator
  const debounceMs = search?.debounceMs ?? DEBOUNCE_MS
  useEffect(() => {
    const q = query.trim()
    const mine = ++seq.current
    if (!orchestrator || q.length < MIN_CHARS) {
      setState({ kind: "idle" })
      return
    }
    const timer = setTimeout(() => {
      setState({ kind: "searching" })
      searchTasks(orchestrator.listTasks(), q, LIMIT).then(
        (result) => mine === seq.current && setState({ kind: "done", result }),
        (err: unknown) =>
          mine === seq.current &&
          setState({ kind: "failed", reason: err instanceof Error ? err.message : String(err) }),
      )
    }, debounceMs)
    return () => clearTimeout(timer)
  }, [query, orchestrator, debounceMs])
  return state
}

export function useMatchingTasks(search: PaletteSearch | undefined, query: string): readonly Task[] {
  const tasks = search?.tasks
  return useMemo(() => (tasks ? matchingTasks(tasks, query) : []), [tasks, query])
}

/** `text` split around each case-insensitive `needle`; odd parts are the matches. */
export function splitMarked(text: string, needle: string): readonly string[] {
  const n = needle.trim().toLowerCase()
  if (!n) return [text]
  const lower = text.toLowerCase()
  const parts: string[] = []
  let from = 0
  for (let at = lower.indexOf(n); at >= 0; at = lower.indexOf(n, from)) {
    parts.push(text.slice(from, at), text.slice(at, at + n.length))
    from = at + n.length
  }
  parts.push(text.slice(from))
  return parts
}
