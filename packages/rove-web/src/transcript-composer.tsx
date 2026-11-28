/**
 * Lightweight inline composer at the bottom of `TranscriptView`: submits prompts
 * via `tab.send` (`rove api send --plain`) to the task's active engine tab.
 */

import { type FormEvent, type KeyboardEvent, useRef, useState } from "react"
import type { TaskRow } from "rove-bridge/protocol"
import { BridgeRequestError } from "./bridge.ts"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { toast } from "./ui.ts"
import { Button } from "./ui/button.tsx"
import { GROW, useGrow } from "./ui/grow.ts"
import * as s from "./ui/transcript.ts"

interface SendReply {
  readonly delivered?: boolean
  readonly queued?: boolean
  readonly reason?: string
}

/** Per-task draft text so switching tasks does not drop an unsent message. */
const drafts = new Map<string, string>()

/** Format a `tab.send` error into user-facing copy (pure, testable). */
export function composerSendError(err: unknown): string {
  const code = err instanceof BridgeRequestError ? err.code : undefined
  if (code === "UNKNOWN_OP") return t("layout.composerOldBridge")
  if (code === "AWAITING_PERMISSION") return t("layout.composerAtMenu")
  return err instanceof Error ? err.message : String(err)
}

export function TranscriptComposer({
  model,
  task,
  narrow = false,
  onSent,
}: {
  model: AppModel
  task: TaskRow
  narrow?: boolean
  onSent: () => void
}) {
  useLocale()
  const [text, setText] = useState(() => drafts.get(task.id) ?? "")
  const [busy, setBusy] = useState(false)
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const grow = useGrow(text, fieldRef)

  // Remote-machine rows are read-only here, matching TermComposer.
  if (task.machine) return null

  const update = (next: string): void => {
    setText(next)
    if (next) drafts.set(task.id, next)
    else drafts.delete(task.id)
  }

  const submit = async (): Promise<void> => {
    const prompt = text.trim()
    if (!prompt || busy) return
    setBusy(true)
    try {
      const target = model.engineTarget(task.id)
      const res = await model.client.request<SendReply>("tab.send", { ...target, prompt })
      if (res.queued) {
        update("")
        toast(t("transcript.composerQueued"))
        onSent()
        return
      }
      if (!res.delivered) {
        toast(t("layout.composerNotSent", { reason: res.reason ?? "" }), "error")
        return
      }
      update("")
      onSent()
    } catch (err) {
      toast(composerSendError(err), "error")
    } finally {
      setBusy(false)
    }
  }

  const onFormSubmit = (e: FormEvent): void => {
    e.preventDefault()
    void submit()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    } else if (e.key === "Escape") {
      e.stopPropagation()
      e.currentTarget.blur()
    }
  }

  const engineName = task.engine?.name
  const placeholder = engineName
    ? t("transcript.composerPlaceholderEngine", { engine: engineName })
    : t("transcript.composerPlaceholder")
  const canSend = !busy && text.trim() !== ""

  return (
    <form className={s.chatComposerClass(narrow)} onSubmit={onFormSubmit}>
      <div className={s.CHAT_COMPOSER_ROW}>
        <textarea
          ref={grow}
          className={`${GROW} ${s.CHAT_COMPOSER_INPUT}`}
          rows={1}
          value={text}
          placeholder={placeholder}
          aria-label={placeholder}
          disabled={busy}
          enterKeyHint="send"
          onChange={(e) => update(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button
          type="submit"
          variant="filled"
          className={s.CHAT_COMPOSER_SEND}
          disabled={!canSend}
          aria-label={t("transcript.composerSend")}
        >
          {busy ? t("transcript.composerSending") : t("transcript.composerSend")}
        </Button>
      </div>
    </form>
  )
}
