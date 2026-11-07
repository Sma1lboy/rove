/**
 * Typing to an engine on a phone: a message is composed in a native field (the soft keyboard's autocorrect,
 * dictation and paste work there, unlike in xterm) and sent whole with `tab.send`, which pastes and submits it
 * through the engine's own composer, the way `rove api send` does. A busy engine queues or steers it with its
 * own input queue; Rove holds nothing. A draft survives switching tabs; it is cleared once the engine took it.
 */

import { useRef, useState, useSyncExternalStore } from "react"
import { flushSync } from "react-dom"
import { AttachPicker, AttachmentThumbs, fileTargets, useAttachments, withRefs } from "./attachments.tsx"
import { BridgeRequestError } from "./bridge.ts"
import { DictationButton, useVoiceHosted } from "./voice/dictation-button.tsx"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { useSnippetSuggest } from "./snippet-suggest.tsx"
import { useStore } from "./store.ts"
import { draftKey, getDraft, setDraft, subscribeDrafts } from "./term-drafts.ts"
import { toast } from "./ui.ts"
import {
  COMPOSER_ATTACH,
  ClipGlyph,
  HoldFace,
  KeysButton,
  MicFace,
  TermComposerBar,
  composerHold,
  composerMic,
} from "./ui/term-composer.tsx"

interface SendReply {
  readonly delivered: boolean
  readonly reason?: string
}

export function TermComposer({ model, taskId, tabId }: { model: AppModel; taskId: string; tabId: string }) {
  // Another machine's rows are read-only here, as in the TUI: nothing is sent to them.
  const task = useStore(model.tasks)?.tasks.find((row) => row.id === taskId)
  const local = task !== undefined
  const key = draftKey(taskId, tabId)
  const text = useSyncExternalStore(subscribeDrafts, () => getDraft(key))
  const [busy, setBusy] = useState(false)
  const { attachments, attach, remove, clear } = useAttachments(model, (message) => toast(message, "error"))
  const field = useRef<HTMLTextAreaElement>(null)
  // Talking comes first on a phone: the field shows only for a draft, an attachment, or the keyboard key.
  const hosted = useVoiceHosted(model.client)
  const [typing, setTyping] = useState(false)
  const snippets = useSnippetSuggest({
    value: text,
    onChange: (next) => setDraft(key, next),
    area: field,
    listClassName: "m-0",
  })
  // Lands at the caret of the draft. A tap or a plain hold stops there, to be read before it goes to the engine.
  const insertDictated = (spoken: string): void => {
    const el = field.current
    const at = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    const glue = at > 0 && !/\s$/.test(text.slice(0, at)) ? " " : ""
    const next = `${text.slice(0, at)}${glue}${spoken}${text.slice(end)}`
    setDraft(key, next)
    const caret = at + glue.length + spoken.length
    requestAnimationFrame(() => el?.setSelectionRange(caret, caret))
  }
  // A hold slid up goes straight to the engine: the bar never flips to the field on the way. Only a send
  // that fails leaves the words in the field, so nothing said is lost.
  const sendSpoken = async (spoken: string) => {
    const draft = text.trim() ? `${text.trimEnd()} ${spoken}` : spoken
    if (!(await send(draft))) setDraft(key, draft)
  }
  const sendDictated = (spoken: string) => void sendSpoken(spoken)
  /** True once the engine has it. */
  const send = async (draft = text): Promise<boolean> => {
    const prompt = withRefs(draft.trim(), attachments).trim()
    if (!prompt) return false
    setBusy(true)
    try {
      const res = await model.client.request<SendReply>("tab.send", { taskId, tabId, prompt })
      if (!res.delivered) {
        toast(t("layout.composerNotSent", { reason: res.reason ?? "" }), "error")
        return false
      }
      setDraft(key, "")
      clear()
      setTyping(false)
      return true
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
      return false
    } finally {
      setBusy(false)
    }
  }
  if (!local) return null
  const onFiles = (files: File[]) => void attach(files)
  const talk = {
    client: model.client,
    context: () => ({ draft: text, taskId, tabId }),
    onText: (spoken: string) => void insertDictated(spoken),
    disabled: busy,
  }
  const voiceFirst = hosted === true && !typing && text === "" && attachments.length === 0
  const toKeys = () => {
    // Synchronously, inside the tap: iOS raises the keyboard only for a focus the gesture itself made.
    flushSync(() => setTyping(true))
    field.current?.focus()
  }
  return (
    <TermComposerBar
      value={text}
      placeholder={t("layout.composerPlaceholder")}
      sendLabel={t("layout.composerSend")}
      busy={busy}
      ready={text.trim() !== "" || attachments.length > 0}
      attached={<AttachmentThumbs attachments={attachments} onRemove={remove} />}
      attach={
        <AttachPicker className={COMPOSER_ATTACH} title={t("layout.composerAttach")} disabled={busy} onFiles={onFiles}>
          <span className="sr-only">{t("layout.composerAttach")}</span>
          <ClipGlyph />
        </AttachPicker>
      }
      dictate={<DictationButton {...talk} look={composerMic} face={(state) => <MicFace state={state} />} />}
      voice={
        voiceFirst ? (
          <>
            <DictationButton
              {...talk}
              onSend={sendDictated}
              look={composerHold}
              idle={t("voice.hold")}
              face={(state) => (
                <HoldFace
                  state={state}
                  idle={t("voice.hold")}
                  working={t("voice.working")}
                  slide={t("voice.slideToSend")}
                  release={t("voice.tipSend")}
                />
              )}
            />
            <KeysButton label={t("voice.type")} onClick={toKeys} />
          </>
        ) : undefined
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
