/**
 * Settings → Feedback: one box. Its text goes to an agent that drafts the issue and files it once the user says OK,
 * or straight to a public GitHub issue through `feedback.send`, titled by its first line.
 */

import { useState } from "react"
import { errorText } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { reportProblem } from "./report-problem.ts"
import { toast } from "./ui.ts"
import { Button } from "./ui/button.tsx"
import { TEXTAREA } from "./ui/form.ts"
import { useGrow } from "./ui/grow.ts"
import { Segmented } from "./ui/segmented.tsx"
import { FEEDBACK_BAR, FEEDBACK_FOOTNOTE, SETTINGS_INPUT, SETTINGS_NOTE } from "./ui/settings.ts"
import { ACTIONS } from "./ui/text.ts"

type Kind = "bug" | "idea" | "question"
type Reply = { filed: boolean; url: string; number?: number; hint?: string }

const KIND_LABEL = {
  bug: "settings.feedback.kindBug",
  idea: "settings.feedback.kindIdea",
  question: "settings.feedback.kindQuestion",
} as const

/** The issue's title: the first line that has text, cut to what reads in a GitHub list. */
export function issueTitle(text: string): string {
  const line =
    text
      .split("\n")
      .find((l) => l.trim())
      ?.trim() ?? ""
  return line.length > 120 ? `${line.slice(0, 119).trimEnd()}…` : line
}

export function FeedbackSection({ model }: { model: AppModel }) {
  const [kind, setKind] = useState<Kind>("bug")
  const [text, setText] = useState("")
  const grow = useGrow(text)
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState<Reply | null>(null)
  const [reportFailed, setReportFailed] = useState(false)
  const empty = !text.trim()
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        setBusy(true)
        setReportFailed(false)
        reportProblem(model, empty ? undefined : { text: text.trim(), kind })
          .catch(() => setReportFailed(true))
          .finally(() => setBusy(false))
      }}
    >
      {/* On a phone the page's line is its one intro; this becomes the footnote under the buttons. */}
      <p className={`m-0 ${SETTINGS_NOTE} ${FEEDBACK_FOOTNOTE}`}>{t("settings.feedback.hint")}</p>
      <textarea
        ref={grow}
        className={`${SETTINGS_INPUT} ${TEXTAREA} w-full`}
        aria-label={t("settings.feedback.prompt")}
        placeholder={t("settings.feedback.prompt")}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {(reply || reportFailed) && (
        <p className={`m-0 ${SETTINGS_NOTE} break-words`}>
          {reportFailed
            ? t("settings.feedback.reportFailed")
            : reply?.filed
              ? t("settings.feedback.sent", { number: reply.number ?? 0 })
              : t("settings.feedback.notFiled", { hint: reply?.hint ?? "" })}{" "}
          {reply && !reportFailed && (
            <a className="underline" href={reply.url} target="_blank" rel="noreferrer">
              {reply.filed ? reply.url : t("settings.feedback.openLink")}
            </a>
          )}
        </p>
      )}
      <div className={FEEDBACK_BAR}>
        <Segmented
          label={t("settings.feedback.kindLabel")}
          value={kind}
          picks={(Object.keys(KIND_LABEL) as Kind[]).map((k) => ({ value: k, label: t(KIND_LABEL[k]) }))}
          onPick={setKind}
        />
        <div className={ACTIONS}>
          <Button
            variant="action"
            type="button"
            disabled={busy || empty}
            onClick={() => {
              setBusy(true)
              setReply(null)
              setReportFailed(false)
              void model.client
                .request<Reply>("feedback.send", { title: issueTitle(text), body: text.trim(), kind })
                .then((r) => {
                  setReply(r)
                  // Not filed keeps the draft: the prefilled link carries it, and a retry after `gh auth login` needs it.
                  if (r.filed) setText("")
                })
                .catch((err) => toast(errorText(err), "error"))
                .finally(() => setBusy(false))
            }}
          >
            {t("settings.feedback.fileAsIs")}
          </Button>
          <Button variant="filled" type="submit" disabled={busy}>
            {t("settings.feedback.draft")}
          </Button>
        </div>
      </div>
      <p className={`m-0 ${SETTINGS_NOTE}`}>{t("settings.feedback.note")}</p>
    </form>
  )
}
