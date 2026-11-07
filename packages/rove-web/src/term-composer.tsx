/**
 * Typing to an engine on a phone: a message is composed in a native field (the soft keyboard's autocorrect,
 * dictation and paste work there, unlike in xterm) and sent whole with `tab.send`, which pastes and submits it
 * through the engine's own composer, the way `rove api send` does. Always with `queue`: a busy engine gets it
 * when its turn ends instead of mid-turn, where Codex drops the work in flight and Claude Code folds it in.
 * A draft survives switching tabs; it is cleared once the engine took the message or the daemon held it.
 */

import { useRef, useState, useSyncExternalStore } from "react"
import { AttachPicker, AttachmentThumbs, fileTargets, useAttachments, withRefs } from "./attachments.tsx"
import { BridgeRequestError } from "./bridge.ts"
import { DictationButton } from "./dictation-button.tsx"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { useSnippetSuggest } from "./snippet-suggest.tsx"
import { useStore } from "./store.ts"
import { draftKey, getDraft, setDraft, subscribeDrafts } from "./term-drafts.ts"
import { QueuedChips } from "./term-queue.tsx"
import { toast } from "./ui.ts"
import { COMPOSER_ATTACH, ClipGlyph, TermComposerBar, composerDictate } from "./ui/term-composer.tsx"

interface SendReply {
  readonly delivered: boolean
  readonly queued?: boolean
  readonly position?: number
  readonly reason?: string
}

export function TermComposer({ model, taskId, tabId }: { model: AppModel; taskId: string; tabId: string }) {
  // Another machine's rows are read-only here, as in the TUI: nothing is sent to them.
  const task = useStore(model.tasks)?.tasks.find((row) => row.id === taskId)
  const local = task !== undefined
  const key = draftKey(taskId, tabId)
  const text = useSyncExternalStore(subscribeDrafts, () => getDraft(key))
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const { attachments, attach, remove, clear } = useAttachments(model, (message) => toast(message, "error"))
  const field = useRef<HTMLTextAreaElement>(null)
  const snippets = useSnippetSuggest({
    value: text,
    onChange: (next) => setDraft(key, next),
    area: field,
    listClassName: "m-0",
  })
  // Lands at the caret of the draft. A tap or a plain hold stops there, to be read before it goes to the engine.
  const insertDictated = (spoken: string): string => {
    const el = field.current
    const at = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    const glue = at > 0 && !/\s$/.test(text.slice(0, at)) ? " " : ""
    const next = `${text.slice(0, at)}${glue}${spoken}${text.slice(end)}`
    setDraft(key, next)
    const caret = at + glue.length + spoken.length
    requestAnimationFrame(() => el?.setSelectionRange(caret, caret))
    return next
  }
  // A hold slid up: the same insert, then the whole draft goes. A failed send leaves it in the field.
  const sendDictated = (spoken: string) => void send(insertDictated(spoken))
  const send = async (draft = text) => {
    const prompt = withRefs(draft.trim(), attachments).trim()
    if (!prompt) return
    setBusy(true)
    try {
      const res = await model.client.request<SendReply>("tab.send", { taskId, tabId, prompt, queue: true })
      if (!res.delivered && !res.queued) {
        toast(t("layout.composerNotSent", { reason: res.reason ?? "" }), "error")
        return
      }
      if (res.queued) {
        toast(t("layout.composerQueued", { position: res.position ?? 1 }))
        setRevision((n) => n + 1)
      }
      setDraft(key, "")
      clear()
    } catch (err) {
      // A bridge older than this page has no `tab.send`: say so rather than print `unknown op`.
      const code = err instanceof BridgeRequestError ? err.code : undefined
      // The engine waits at a menu: a send would paste into it and Enter would take its highlighted option.
      const message =
        code === "UNKNOWN_OP"
          ? t("layout.composerOldBridge")
          : code === "AWAITING_PERMISSION"
            ? t("layout.composerAtMenu")
            : err instanceof Error
              ? err.message
              : String(err)
      toast(message, "error")
    } finally {
      setBusy(false)
    }
  }
  if (!local) return null
  const onFiles = (files: File[]) => void attach(files)
  return (
    <TermComposerBar
      value={text}
      placeholder={t("layout.composerPlaceholder")}
      sendLabel={t("layout.composerSend")}
      busy={busy}
      ready={text.trim() !== "" || attachments.length > 0}
      attached={
        <>
          <QueuedChips model={model} taskId={taskId} tabId={tabId} revision={revision} />
          <AttachmentThumbs attachments={attachments} onRemove={remove} />
        </>
      }
      attach={
        <AttachPicker className={COMPOSER_ATTACH} title={t("layout.composerAttach")} disabled={busy} onFiles={onFiles}>
          <span className="sr-only">{t("layout.composerAttach")}</span>
          <ClipGlyph />
        </AttachPicker>
      }
      dictate={
        <DictationButton
          client={model.client}
          context={() => [task?.repo ?? "", task?.title ?? "", text.slice(-120)].filter(Boolean).join(" · ")}
          onText={(spoken) => void insertDictated(spoken)}
          onSend={sendDictated}
          disabled={busy}
          look={composerDictate}
        />
      }
      composerKey={key}
      fieldRef={field}
      suggest={snippets.list}
      {...snippets.field}
      onPaste={fileTargets(onFiles).onPaste}
      onSend={() => void send()}
    />
  )
}
