/** Settings → Feedback: a title and a body, posted as a public GitHub Discussion by `feedback.send`. */

import { useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { errorText } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import { toast } from "./ui.ts"
import { Button } from "./ui/button.tsx"
import {
  SETTINGS_ACTIONS,
  SETTINGS_FIELD,
  SETTINGS_FIELD_LABEL,
  SETTINGS_INPUT,
  SETTINGS_NOTE,
  SETTINGS_TEXTAREA,
} from "./ui/settings.ts"

export function FeedbackSection({ client }: { client: BridgeClient }) {
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!title.trim() || !body.trim()) return
        setBusy(true)
        void client
          .request<{ discussion?: { url?: string } }>("feedback.send", { title: title.trim(), body })
          .then((r) => {
            toast(t("settings.feedback.sent", { url: r.discussion?.url ?? "" }))
            setTitle("")
            setBody("")
          })
          .catch((err) => toast(errorText(err), "error"))
          .finally(() => setBusy(false))
      }}
    >
      <p className={`m-0 ${SETTINGS_NOTE}`}>{t("settings.feedback.hint")}</p>
      <label className={SETTINGS_FIELD}>
        <span className={SETTINGS_FIELD_LABEL}>{t("settings.feedback.titleLabel")}</span>
        <input className={`${SETTINGS_INPUT} w-full`} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className={SETTINGS_FIELD}>
        <span className={SETTINGS_FIELD_LABEL}>{t("settings.feedback.body")}</span>
        <textarea
          className={`${SETTINGS_INPUT} ${SETTINGS_TEXTAREA} w-full`}
          rows={6}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <div className={SETTINGS_ACTIONS}>
        <Button variant="filled" type="submit" disabled={busy || !title.trim() || !body.trim()}>
          {t("settings.feedback.send")}
        </Button>
      </div>
    </form>
  )
}
