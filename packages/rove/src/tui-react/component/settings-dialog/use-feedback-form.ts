/** The Feedback section's form: draft, status line, and filing it as an issue. */

import { errorMessage } from "@/lib/error-message"
import { useState } from "react"
import { failureHint } from "../../../lib/failure-hint"
import { submitFeedback } from "../../../lib/feedback"
import { useT } from "../../i18n"

export function useFeedbackForm(onSent: () => void) {
  const t = useT()
  const [title, setTitleRaw] = useState("")
  const [body, setBodyRaw] = useState("")
  const [status, setStatus] = useState({ text: "", warn: false })
  const show = (text: string, warn = false) => setStatus({ text, warn })

  function send(): void {
    show(t("settings.feedback.submitting"))
    try {
      const result = submitFeedback({ title, body })
      if (!result.filed) {
        // The draft stays in the form; the prefilled link is the way out.
        show(t("settings.feedback.notFiled", { hint: result.hint, url: result.url }), true)
        return
      }
      show(t("settings.feedback.sent", { number: result.number, url: result.url }))
      setTitleRaw("")
      setBodyRaw("")
      onSent()
    } catch (err) {
      show(t("settings.feedback.error", { message: errorMessage(err), hint: failureHint(err) }), true)
    }
  }

  // An edit clears the last status: it described the draft before this one.
  const setTitle = (v: string) => {
    setTitleRaw(v)
    show("")
  }
  const setBody = (v: string) => {
    setBodyRaw(v)
    show("")
  }
  return { title, body, status: status.text, statusWarn: status.warn, setTitle, setBody, send }
}
