/**
 * An attention card opened in place: the tab's last output, then the way to answer it without leaving the
 * Inbox. A decision gate offers its choices; a menu its keys; anything else a one-line reply. A decision
 * the page cannot answer (an engine that exited) shows the output alone.
 */

import { useEffect, useRef, useState } from "react"
import type { GateRow } from "rove-bridge/protocol"
import { t, useLocale } from "./i18n/index.ts"
import { answerGate, pressKeys, readTail, sendReply } from "./inbox-peek.ts"
import { PEEK_LINES } from "./inbox.ts"
import type { AppModel } from "./model.ts"
import { MENU_KEYS } from "./term-keys.ts"
import { Button } from "./ui/button.tsx"
import { PEEK, PEEK_CHOICES, PEEK_FIELD, PEEK_QUESTION, PEEK_REPLY, PEEK_TAIL } from "./ui/inbox-peek.ts"

const REFRESH_MS = 2000

export type PeekMode = "reply" | "menu" | "gate" | "readonly"

function useTail(
  model: AppModel,
  taskId: string,
  tabId: string | null,
): { lines: string[] | null; refresh: () => void } {
  const [lines, setLines] = useState<string[] | null>(null)
  const [tick, setTick] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is a trigger the body doesn't read
  useEffect(() => {
    if (!tabId) return
    let live = true
    let timer = 0
    const poll = async () => {
      try {
        const next = await readTail(model.client, taskId, tabId)
        if (live) setLines(next)
      } catch {
        if (live) setLines((cur) => cur ?? [])
      }
      if (live) timer = window.setTimeout(poll, REFRESH_MS)
    }
    void poll()
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [model, taskId, tabId, tick])
  return { lines, refresh: () => setTick((n) => n + 1) }
}

export function InboxPeek(props: {
  model: AppModel
  taskId: string
  tabId: string | null
  mode: PeekMode
  gate?: GateRow
  /** Opens the tab itself: the way out for a menu that wants arrow keys. */
  onOpenTab: () => void
}) {
  useLocale()
  const { model, taskId, tabId, mode, gate } = props
  const { lines, refresh } = useTail(model, taskId, tabId)
  const tail = useRef<HTMLPreElement>(null)
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)

  // The newest line stays in view as the tab prints.
  // biome-ignore lint/correctness/useExhaustiveDependencies: lines is the trigger
  useEffect(() => {
    const el = tail.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  const run = async (act: () => Promise<boolean>) => {
    setBusy(true)
    const done = await act()
    setBusy(false)
    if (done) window.setTimeout(refresh, 600)
    return done
  }
  const submit = async () => {
    const prompt = text.trim()
    if (!prompt || busy) return
    const sent = await run(() =>
      mode === "gate" && gate
        ? answerGate(model, gate.id, { text: prompt })
        : tabId
          ? sendReply(model, taskId, tabId, prompt)
          : Promise.resolve(false),
    )
    if (sent) setText("")
  }

  return (
    <div className={PEEK}>
      {gate && <p className={PEEK_QUESTION}>{gate.question}</p>}
      {tabId && (
        <pre ref={tail} className={PEEK_TAIL} data-peek-lines={PEEK_LINES}>
          {lines === null ? "…" : lines.length === 0 ? t("inbox.noOutput") : lines.join("\n")}
        </pre>
      )}
      {mode === "gate" && gate && (
        <div className={PEEK_CHOICES}>
          {gate.options.map((option) => (
            <Button
              key={option.key}
              disabled={busy}
              title={option.detail}
              onClick={() => void run(() => answerGate(model, gate.id, { option: option.key }))}
            >
              [ {option.key === gate.recommended ? "★ " : ""}
              {option.label} ]
            </Button>
          ))}
        </div>
      )}
      {mode === "menu" && tabId && (
        <div className={PEEK_CHOICES}>
          {MENU_KEYS.map((key) => (
            <Button
              key={key.id}
              disabled={busy}
              onClick={() => void run(() => pressKeys(model, taskId, tabId, key.bytes(false)))}
            >
              [ {key.cap} ]
            </Button>
          ))}
          <Button onClick={props.onOpenTab}>{t("inbox.openTab")}</Button>
        </div>
      )}
      {(mode === "reply" || mode === "gate") && (
        <form
          className={PEEK_REPLY}
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <input
            className={PEEK_FIELD}
            value={text}
            disabled={busy}
            placeholder={t("inbox.replyPlaceholder")}
            aria-label={t("inbox.replyPlaceholder")}
            autoComplete="off"
            enterKeyHint="send"
            onChange={(e) => setText(e.target.value)}
          />
          <Button type="submit" disabled={busy || text.trim() === ""}>
            {t("inbox.send")}
          </Button>
        </form>
      )}
    </div>
  )
}
