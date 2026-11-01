import { useState } from "react"
import { forgetToken, saveToken } from "./auth.ts"
import { t, useLocale } from "./i18n/index.ts"
import { tokenFromInput } from "./token-input.ts"
import { buttonClass } from "./ui/button.tsx"
import { BRACKET, CONNECT, CONNECT_CARD, WORDMARK } from "./ui/shell.ts"
import { ACTIONS, INPUT, KICKER, LINK } from "./ui/text.ts"

export function ConnectScreen({ failing = false }: { failing?: boolean }) {
  useLocale()
  const [value, setValue] = useState("")
  const [invalid, setInvalid] = useState(false)
  return (
    <div className={CONNECT}>
      <form
        className={CONNECT_CARD}
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
        <span className={WORDMARK}>
          <span className={BRACKET}>[</span> rove <span className={BRACKET}>]</span>
        </span>
        <h1 className={`${KICKER} text-muted`}>{t("connect.title")}</h1>
        <p className={failing ? "text-error" : "text-muted"}>{failing ? t("connect.failing") : t("connect.body")}</p>
        <input
          className={INPUT}
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
        {invalid && <p className="text-error">{t("connect.invalid")}</p>}
        <div className={ACTIONS}>
          {failing && (
            <button
              type="button"
              className={`${LINK} text-accent`}
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
