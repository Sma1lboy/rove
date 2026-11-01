/** Settings → Feedback: a title and a body, posted as a public GitHub Discussion by `feedback.send`. */

import { useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { errorText } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import { toast } from "./ui.ts"
import { buttonClass } from "./ui/button.tsx"
import { FIELD, TEXTAREA } from "./ui/form.ts"
import { SETTINGS_GROUP } from "./ui/settings.ts"
import { ACTIONS, INPUT, KICKER } from "./ui/text.ts"

export function FeedbackSection({ client }: { client: BridgeClient }) {
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  return (
    <form
      className={SETTINGS_GROUP}
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
      <p className="text-muted">{t("settings.feedback.hint")}</p>
      <label className={FIELD}>
        <span className={`${KICKER} text-muted`}>{t("settings.feedback.titleLabel")}</span>
        <input className={INPUT} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className={FIELD}>
        <span className={`${KICKER} text-muted`}>{t("settings.feedback.body")}</span>
        <textarea className={`${INPUT} ${TEXTAREA}`} rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <div className={ACTIONS}>
        <button type="submit" className={buttonClass()} disabled={busy || !title.trim() || !body.trim()}>
          {t("settings.feedback.send")}
        </button>
      </div>
    </form>
  )
}
