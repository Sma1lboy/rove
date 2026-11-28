/**
 * The side panel's Chat tab: the engine's own conversation (`output.read` history, the same for claude and codex)
 * as readable messages, newest at the bottom. Reading only: the composer stays in the terminal. Tool calls are one
 * line each; Copy takes one message, Export the thread, and the find box steps through matches.
 */

import { type KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { TaskRow } from "rove-bridge/protocol"
import { t, useLocale } from "./i18n/index.ts"
import { MarkdownView, markText } from "./markdown-view.tsx"
import type { AppModel } from "./model.ts"
import { useStore } from "./store.ts"
import { type Entry, entryCopyText, exportMarkdown, findEntries, hitIsOlder, locateHit } from "./transcript-data.ts"
import { transcriptTarget } from "./transcript-focus.ts"
import { useTranscript } from "./transcript-load.ts"
import { toast } from "./ui.ts"
import { Button } from "./ui/button.tsx"
import { INPUT } from "./ui/text.ts"
import * as s from "./ui/transcript.ts"

/** Re-read this often while the engine works; once it stops, one last read picks up the end. */
const LIVE_MS = 3000
/** Scrolled this close to the top, the next older page loads; this close to the bottom, new messages keep it pinned. */
const EDGE_PX = 80
const FLASH_MS = 2500

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }))
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

const timeOf = (at: string): string => {
  const when = new Date(at)
  return Number.isNaN(when.getTime()) ? "" : when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function EntryView(props: {
  entry: Entry
  failed: ReadonlySet<string>
  needle: string
  flash: boolean
  current: boolean
  onCopy: () => void
}) {
  const { entry } = props
  const who = t(
    entry.role === "user" ? "transcript.you" : entry.role === "assistant" ? "transcript.agent" : "transcript.system",
  )
  return (
    <article className={s.chatEntryClass(props)} data-index={entry.index}>
      <header className={s.CHAT_HEAD}>
        <span className={s.chatWho(entry.role)}>{who}</span>
        <span className={s.CHAT_WHEN}>{timeOf(entry.at)}</span>
        <Button className={s.CHAT_COPY} onClick={props.onCopy}>
          {t("transcript.copy")}
        </Button>
      </header>
      {entry.text !== "" && <MarkdownView source={entry.text} needle={props.needle} />}
      {entry.tools.map((tool, i) => (
        // A message's calls have no ids of their own to key on; their order is fixed.
        // biome-ignore lint/suspicious/noArrayIndexKey: order is the identity
        <p key={i} className={s.CHAT_TOOL} title={`${tool.name} ${tool.summary}`}>
          <span className={s.CHAT_TOOL_NAME}>{markText(tool.name, props.needle)}</span>
          <span className={s.CHAT_TOOL_TEXT}>{markText(tool.summary, props.needle)}</span>
          {props.failed.has(tool.callId) && <span className={s.CHAT_TOOL_FAILED}>{t("transcript.failed")}</span>}
        </p>
      ))}
    </article>
  )
}

export function TranscriptView({ model, task, active }: { model: AppModel; task: TaskRow; active: boolean }) {
  useLocale()
  const loader = useTranscript(model, task.id)
  const { state } = loader
  const [query, setQuery] = useState("")
  const [step, setStep] = useState(0)
  const [flash, setFlash] = useState<number | null>(null)
  const thread = useRef<HTMLDivElement>(null)
  // Pinned to the bottom until the reader scrolls up; what keeps the newest message in view as it arrives.
  const pinned = useRef(true)
  // The thread's height and offset before an older page lands, so the reader keeps their place.
  const anchor = useRef<{ height: number; top: number } | null>(null)
  const target = useStore(transcriptTarget)

  const ready = state.kind === "ready" ? state : null
  const entries = useMemo(() => ready?.transcript.entries ?? [], [ready?.transcript])
  const failed = ready?.transcript.failed ?? new Set<string>()
  const matches = useMemo(() => findEntries(entries, query), [entries, query])
  const at = matches.length === 0 ? 0 : Math.min(step, matches.length - 1)
  const currentIndex = matches[at] ?? null

  const scrollTo = (index: number) => {
    pinned.current = false
    thread.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "center" })
  }

  // Live: while the engine works, read what it wrote since; the moment it stops, once more.
  const kind = task.rowStatus?.kind
  const live = kind === "running" || kind === "needs-input"
  const { refresh } = loader
  // biome-ignore lint/correctness/useExhaustiveDependencies: a status change is the cue to read again
  useEffect(() => {
    if (active) void refresh()
  }, [active, kind, refresh])
  useEffect(() => {
    if (!active || !live) return
    const timer = setInterval(() => void refresh(), LIVE_MS)
    return () => clearInterval(timer)
  }, [active, live, refresh])

  // New messages keep a pinned reader at the bottom; an older page keeps the reader's place.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the loaded messages change
  useLayoutEffect(() => {
    const el = thread.current
    if (!el) return
    if (anchor.current) {
      el.scrollTop = anchor.current.top + (el.scrollHeight - anchor.current.height)
      anchor.current = null
    } else if (pinned.current) el.scrollTop = el.scrollHeight
  }, [entries])

  const older = async () => {
    const el = thread.current
    if (el) anchor.current = { height: el.scrollHeight, top: el.scrollTop }
    await loader.loadOlder()
  }

  // A palette hit: find its message, paging back through older ones until it turns up.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `older` and `scrollTo` are fresh closures each render; the request and what has loaded are the cues
  useEffect(() => {
    if (!target || target.taskId !== task.id || !ready || !active) return
    const index = locateHit(entries, target.hit)
    if (index !== null) {
      setFlash(index)
      scrollTo(index)
      transcriptTarget.set(null)
    } else if (ready.older && hitIsOlder(entries, target.hit)) {
      void older()
    } else transcriptTarget.set(null)
  }, [target, ready, entries, active, task.id])

  useEffect(() => {
    if (flash === null) return
    const timer = setTimeout(() => setFlash(null), FLASH_MS)
    return () => clearTimeout(timer)
  }, [flash])

  // Typing in the find box jumps to its first match.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new query moves the view
  useEffect(() => {
    setStep(0)
    const first = findEntries(entries, query)[0]
    if (first !== undefined) scrollTo(first)
  }, [query])

  const go = (delta: number) => {
    if (matches.length === 0) return
    const next = (at + delta + matches.length) % matches.length
    setStep(next)
    scrollTo(matches[next] as number)
  }

  const find = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault()
      go(e.shiftKey ? -1 : 1)
    } else if (e.key === "Escape" && query !== "") {
      e.stopPropagation()
      setQuery("")
    }
  }

  const copy = (entry: Entry) =>
    void navigator.clipboard.writeText(entryCopyText(entry, failed)).then(
      () => toast(t("transcript.copied")),
      () => toast(t("menu.copyFailed"), "error"),
    )

  const exportAll = async () => {
    const all = await loader.loadAll()
    if (!all) return
    const names = { user: t("transcript.you"), assistant: t("transcript.agent"), system: t("transcript.system") }
    const slug = task.label.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "conversation"
    download(`${slug}.md`, exportMarkdown(task.label, all.entries, all.failed, names))
  }

  if (state.kind === "loading")
    return (
      <div className={s.CHAT}>
        <p className={s.CHAT_NOTE}>{t("transcript.loading")}</p>
      </div>
    )
  if (state.kind === "error") {
    return (
      <div className={s.CHAT}>
        <p className={`${s.CHAT_NOTE} text-error`}>{t("transcript.error", { error: state.message })}</p>
        <p className={s.CHAT_NOTE}>
          <Button onClick={loader.reload}>{t("transcript.retry")}</Button>
        </p>
      </div>
    )
  }
  if (state.kind === "terminal") {
    return (
      <div className={s.CHAT}>
        <p className={s.CHAT_NOTE}>{t("transcript.noHistory")}</p>
        <pre className={`${s.CHAT_TAIL} min-h-0 flex-1 overflow-y-auto`}>{state.tail.join("\n")}</pre>
      </div>
    )
  }

  return (
    <div className={s.CHAT}>
      <div className={s.CHAT_BAR}>
        <input
          className={`${INPUT} ${s.CHAT_FIND}`}
          value={query}
          placeholder={t("transcript.findPlaceholder")}
          aria-label={t("transcript.findPlaceholder")}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={find}
        />
        {query.trim() !== "" && (
          <>
            <span className={s.CHAT_COUNT}>
              {matches.length === 0
                ? t("transcript.findNone")
                : t("transcript.findCount", { at: at + 1, total: matches.length })}
            </span>
            <Button onClick={() => go(-1)} disabled={matches.length === 0}>
              {t("transcript.prev")}
            </Button>
            <Button onClick={() => go(1)} disabled={matches.length === 0}>
              {t("transcript.next")}
            </Button>
          </>
        )}
        <Button onClick={() => void exportAll()} disabled={entries.length === 0}>
          {t("transcript.export")}
        </Button>
      </div>
      <div
        ref={thread}
        className={s.CHAT_THREAD}
        onScroll={(e) => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < EDGE_PX
          if (el.scrollTop < EDGE_PX && ready?.older && !loader.paging) void older()
        }}
      >
        {ready?.older && (
          <p className={s.CHAT_NOTE}>
            <Button onClick={() => void older()} disabled={loader.paging}>
              {t("transcript.older")}
            </Button>
          </p>
        )}
        {entries.length === 0 && <p className={s.CHAT_NOTE}>{t("transcript.empty")}</p>}
        {entries.map((entry) => (
          <EntryView
            key={entry.index}
            entry={entry}
            failed={failed}
            needle={query}
            flash={flash === entry.index}
            current={currentIndex === entry.index}
            onCopy={() => copy(entry)}
          />
        ))}
      </div>
    </div>
  )
}
