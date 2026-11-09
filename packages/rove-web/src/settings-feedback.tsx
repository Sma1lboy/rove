/** Settings → Feedback: a kind, a title and a body filed as a public GitHub issue by `feedback.send`, or an agent that drafts it. */

import { useState } from "react"
import { errorText } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { reportProblem } from "./report-problem.ts"
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

type Kind = "bug" | "idea" | "question"
type Reply = { filed: boolean; url: string; number?: number; hint?: string }

const KIND_LABEL = {
  bug: "settings.feedback.kindBug",
  idea: "settings.feedback.kindIdea",
  question: "settings.feedback.kindQuestion",
} as const

export function FeedbackSection({ model }: { model: AppModel }) {
  const [kind, setKind] = useState<Kind>("bug")
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState<Reply | null>(null)
  const [reportFailed, setReportFailed] = useState(false)
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!title.trim() || !body.trim()) return
        setBusy(true)
        setReply(null)
        void model.client
          .request<Reply>("feedback.send", { title: title.trim(), body, kind })
          .then((r) => {
            setReply(r)
            // Not filed keeps the draft: the prefilled link carries it, and a retry after `gh auth login` needs it.
            if (!r.filed) return
            setTitle("")
            setBody("")
          })
          .catch((err) => toast(errorText(err), "error"))
          .finally(() => setBusy(false))
      }}
    >
      <p className={`m-0 ${SETTINGS_NOTE}`}>{t("settings.feedback.hint")}</p>
      <div className="flex flex-col gap-1">
        <div className={SETTINGS_ACTIONS}>
          <Button
            variant="action"
            type="button"
            onClick={() => {
              setReportFailed(false)
              reportProblem(model).catch(() => setReportFailed(true))
            }}
          >
            {t("settings.feedback.report")}
          </Button>
        </div>
        <p className={`m-0 ${SETTINGS_NOTE}`}>
          {reportFailed ? t("settings.feedback.reportFailed") : t("settings.feedback.reportNote")}
        </p>
      </div>
      <label className={SETTINGS_FIELD}>
        <span className={SETTINGS_FIELD_LABEL}>{t("settings.feedback.kindLabel")}</span>
        <select className={`${SETTINGS_INPUT} w-full`} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
            <option key={k} value={k}>
              {t(KIND_LABEL[k])}
            </option>
          ))}
        </select>
      </label>
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
      {reply && (
        <p className={`m-0 ${SETTINGS_NOTE} break-words`}>
          {reply.filed
            ? t("settings.feedback.sent", { number: reply.number ?? 0 })
            : t("settings.feedback.notFiled", { hint: reply.hint ?? "" })}{" "}
          <a className="underline" href={reply.url} target="_blank" rel="noreferrer">
            {reply.filed ? reply.url : t("settings.feedback.openLink")}
          </a>
        </p>
      )}
      <div className={SETTINGS_ACTIONS}>
        <Button variant="filled" type="submit" disabled={busy || !title.trim() || !body.trim()}>
          {t("settings.feedback.send")}
        </Button>
      </div>
    </form>
  )
}
