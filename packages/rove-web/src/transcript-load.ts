/**
 * Reads a task's conversation for the Chat tab: the newest page first, older pages on demand, and the forward
 * cursor as the poll point for what the engine writes next. An engine with no history reader gets its terminal tail.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { errorText } from "./dialogs.tsx"
import type { AppModel } from "./model.ts"
import { EMPTY, type RawMessage, type ReadReply, type Transcript, addPage } from "./transcript-data.ts"

const PAGE = 50

export type TranscriptState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "terminal"; readonly tail: readonly string[] }
  | {
      readonly kind: "ready"
      readonly transcript: Transcript
      /** Poll point: what the session wrote after the newest page. */
      readonly cursor: string | null
      /** The page before the oldest loaded one; null at the start of the conversation. */
      readonly older: string | null
    }

export interface TranscriptLoader {
  readonly state: TranscriptState
  /** True while an older page is on its way. */
  readonly paging: boolean
  readonly loadOlder: () => Promise<void>
  /** Every older page, for an export; the whole conversation as loaded, or null when there is none to read. */
  readonly loadAll: () => Promise<Transcript | null>
  /** Read whatever was written since (or start over when the conversation moved). */
  readonly refresh: () => Promise<void>
  readonly reload: () => void
}

export function useTranscript(model: AppModel, taskId: string): TranscriptLoader {
  const [state, setState] = useState<TranscriptState>({ kind: "loading" })
  const [paging, setPaging] = useState(false)
  const latest = useRef(state)
  latest.current = state
  // One read at a time, and a read for a task or reload that has moved on is dropped.
  const busy = useRef(false)
  const turn = useRef(0)

  const read = useCallback(
    (args: Record<string, unknown>) => model.client.request<ReadReply>("output.read", { taskId, limit: PAGE, ...args }),
    [model, taskId],
  )

  const load = useCallback(async () => {
    const mine = ++turn.current
    busy.current = true
    try {
      const reply = await read({})
      if (mine !== turn.current) return
      if (reply.source === "terminal" || !reply.history) {
        setState({ kind: "terminal", tail: reply.terminal?.tail ?? [] })
        return
      }
      const transcript = addPage(EMPTY, reply.history.messages ?? [], reply.history.firstIndex ?? 0)
      setState({ kind: "ready", transcript, cursor: reply.cursor ?? null, older: reply.olderCursor ?? null })
    } catch (err) {
      if (mine === turn.current) setState({ kind: "error", message: errorText(err) })
    } finally {
      if (mine === turn.current) busy.current = false
    }
  }, [read])

  useEffect(() => {
    setState({ kind: "loading" })
    void load()
    return () => {
      turn.current++
      busy.current = false
    }
  }, [load])

  const refresh = useCallback(async () => {
    const now = latest.current
    if (busy.current) return
    if (now.kind === "terminal") return load()
    if (now.kind !== "ready" || !now.cursor) return
    const mine = turn.current
    busy.current = true
    try {
      const reply = await read({ cursor: now.cursor, source: "history" })
      if (mine !== turn.current) return
      setState((cur) =>
        cur.kind !== "ready"
          ? cur
          : {
              ...cur,
              transcript: addPage(cur.transcript, reply.history?.messages ?? [], reply.history?.firstIndex ?? 0),
              cursor: reply.cursor ?? cur.cursor,
            },
      )
    } catch {
      // The conversation moved (a new session id) or the daemon blinked: read it afresh.
      if (mine === turn.current) {
        busy.current = false
        await load()
      }
    } finally {
      if (mine === turn.current) busy.current = false
    }
  }, [read, load])

  const loadOlder = useCallback(async () => {
    const now = latest.current
    if (busy.current || now.kind !== "ready" || !now.older) return
    const mine = turn.current
    busy.current = true
    setPaging(true)
    try {
      const reply = await read({ cursor: now.older, source: "history" })
      if (mine !== turn.current) return
      setState((cur) =>
        cur.kind !== "ready"
          ? cur
          : {
              ...cur,
              transcript: addPage(cur.transcript, reply.history?.messages ?? [], reply.history?.firstIndex ?? 0),
              older: reply.olderCursor ?? null,
            },
      )
    } catch (err) {
      if (mine === turn.current) setState({ kind: "error", message: errorText(err) })
    } finally {
      if (mine === turn.current) {
        busy.current = false
        setPaging(false)
      }
    }
  }, [read])

  const loadAll = useCallback(async (): Promise<Transcript | null> => {
    const now = latest.current
    if (now.kind !== "ready") return null
    if (busy.current || !now.older) return now.transcript
    const mine = turn.current
    busy.current = true
    setPaging(true)
    const pages: { messages: readonly RawMessage[]; firstIndex: number }[] = []
    let transcript = now.transcript
    try {
      for (let older: string | null = now.older; older && mine === turn.current; ) {
        const reply = await read({ cursor: older, source: "history" })
        const page = { messages: reply.history?.messages ?? [], firstIndex: reply.history?.firstIndex ?? 0 }
        pages.push(page)
        transcript = addPage(transcript, page.messages, page.firstIndex)
        older = reply.olderCursor ?? null
      }
      if (mine !== turn.current) return null
      setState((cur) =>
        cur.kind !== "ready"
          ? cur
          : {
              ...cur,
              transcript: pages.reduce((all, page) => addPage(all, page.messages, page.firstIndex), cur.transcript),
              older: null,
            },
      )
      return transcript
    } catch (err) {
      if (mine === turn.current) setState({ kind: "error", message: errorText(err) })
      return null
    } finally {
      if (mine === turn.current) {
        busy.current = false
        setPaging(false)
      }
    }
  }, [read])

  const reload = useCallback(() => {
    setState({ kind: "loading" })
    void load()
  }, [load])

  return { state, paging, loadOlder, loadAll, refresh, reload }
}
