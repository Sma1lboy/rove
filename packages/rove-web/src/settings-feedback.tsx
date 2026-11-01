/** Settings → Feedback: a title and a body, posted as a public GitHub Discussion by `feedback.send`. */

import { useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { errorText } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import { toast } from "./ui.ts"
import { SETTINGS_GROUP } from "./ui/settings.ts"

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
      <p className="muted">{t("settings.feedback.hint")}</p>
      <label className="field">
        <span className="kicker">{t("settings.feedback.titleLabel")}</span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span className="kicker">{t("settings.feedback.body")}</span>
        <textarea className="input textarea" rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <div className="actions">
        <button type="submit" className="button" disabled={busy || !title.trim() || !body.trim()}>
          {t("settings.feedback.send")}
        </button>
      </div>
    </form>
  )
}
