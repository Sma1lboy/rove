import { useState } from "react"
import { forgetToken, saveToken } from "./auth.ts"
import { t, useLocale } from "./i18n/index.ts"
import { tokenFromInput } from "./token-input.ts"
import { buttonClass } from "./ui/button.tsx"

export function ConnectScreen({ failing = false }: { failing?: boolean }) {
  useLocale()
  const [value, setValue] = useState("")
  const [invalid, setInvalid] = useState(false)
  return (
    <div className="connect">
      <form
        className="connect-card"
        onSubmit={(e) => {
          e.preventDefault()
          const token = tokenFromInput(value)
          if (!token) {
            setInvalid(true)
            return
          }
          saveToken(token)
          window.location.reload()
        }}
      >
        <span className="wordmark">
          <span className="bracket">[</span> rove <span className="bracket">]</span>
        </span>
        <h1 className="kicker">{t("connect.title")}</h1>
        <p className={failing ? "error" : "muted"}>{failing ? t("connect.failing") : t("connect.body")}</p>
        <input
          className="input"
          // biome-ignore lint/a11y/noAutofocus: the only control on the page
          autoFocus
          spellCheck={false}
          placeholder={t("connect.placeholder")}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setInvalid(false)
          }}
        />
        {invalid && <p className="error">{t("connect.invalid")}</p>}
        <div className="actions">
          {failing && (
            <button
              type="button"
              className="link"
              onClick={() => {
                forgetToken()
                window.location.reload()
              }}
            >
              {t("connect.forget")}
            </button>
          )}
          <button type="submit" className={buttonClass()}>
            {t("connect.submit")}
          </button>
        </div>
      </form>
    </div>
  )
}
