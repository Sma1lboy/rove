/** The password screen a page without a token shows when the bridge has a password set. */

import { useState } from "react"
import { t, useLocale } from "./i18n/index.ts"
import { type LoginOutcome, submitPassword } from "./login.ts"
import { buttonClass } from "./ui/button.tsx"

function message(outcome: LoginOutcome | null): string | null {
  if (!outcome) return null
  switch (outcome.kind) {
    case "ok":
      return null
    case "wrong":
      return t("login.wrong")
    case "locked":
      return t("login.locked", { minutes: outcome.minutes })
    case "lockedHost":
      return t("login.lockedHost")
    case "unreachable":
      return t("login.unreachable")
  }
}

export function LoginScreen() {
  useLocale()
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<LoginOutcome | null>(null)
  const error = message(outcome)
  return (
    <div className="connect">
      <form
        className="connect-card"
        onSubmit={async (e) => {
          e.preventDefault()
          if (busy || !password) return
          setBusy(true)
          const next = await submitPassword(password)
          if (next.kind === "ok") {
            window.location.reload()
            return
          }
          setPassword("")
          setOutcome(next)
          setBusy(false)
        }}
      >
        <span className="wordmark">
          <span className="bracket">[</span> rove <span className="bracket">]</span>
        </span>
        <h1 className="kicker">{t("login.title")}</h1>
        <p className="muted">{t("login.body")}</p>
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          aria-label={t("login.field")}
          placeholder={t("login.field")}
          // biome-ignore lint/a11y/noAutofocus: the only control on the page
          autoFocus
          value={password}
          disabled={busy}
          onChange={(e) => {
            setPassword(e.target.value)
            setOutcome(null)
          }}
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="submit" className={buttonClass()} disabled={busy || !password}>
            {busy ? t("login.checking") : t("login.submit")}
          </button>
        </div>
      </form>
    </div>
  )
}
