/**
 * The side panel's Browser: an address bar over an iframe. A frame only shows what the browser can
 * reach and the site lets a page embed, and a refusal is silent, so the open-in-a-new-tab button
 * beside the address always works. Back and forward walk the addresses typed here; moves inside the
 * frame are the frame's own (a cross-origin page's history cannot be read).
 */

import { useState } from "react"
import { canFrame, normalizeUrl } from "./browser-url.ts"
import { t, useLocale } from "./i18n/index.ts"
import { panelUrls, rememberUrl } from "./panel-state.ts"

function Glyph({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const OPEN_TAB = "M6.5 3.5h-3v9h9v-3M9.5 3.5h3v3M12.5 3.5l-5 5"

export function BrowserView({ taskId }: { taskId: string }) {
  useLocale()
  const [nav, setNav] = useState(() => {
    const last = panelUrls.get()[taskId]
    return { urls: last ? [last] : [], at: last ? 0 : -1 }
  })
  const url = nav.urls[nav.at] ?? ""
  const [draft, setDraft] = useState(url)
  const [invalid, setInvalid] = useState(false)
  const [reloads, setReloads] = useState(0)
  const verdict = url ? canFrame(url, window.location) : null

  const move = (at: number) => {
    const to = nav.urls[at]
    if (to === undefined) return
    setNav({ ...nav, at })
    setDraft(to)
    setInvalid(false)
    rememberUrl(taskId, to)
  }
  const load = (input: string) => {
    const next = normalizeUrl(input)
    // An empty field is nothing to load, not a mistake.
    setInvalid(next === null && input.trim() !== "")
    if (next === null) return
    setDraft(next)
    if (next === url) {
      setReloads(reloads + 1)
      return
    }
    setNav({ urls: [...nav.urls.slice(0, nav.at + 1), next], at: nav.at + 1 })
    rememberUrl(taskId, next)
  }

  const message =
    verdict === null
      ? invalid
        ? t("browser.invalid")
        : t("browser.empty")
      : verdict === "self"
        ? t("browser.self")
        : verdict === "unreachable"
          ? t("browser.noFrame")
          : null

  return (
    <div className="browser">
      <form
        className="browser-bar"
        onSubmit={(e) => {
          e.preventDefault()
          load(draft)
        }}
      >
        <button
          type="button"
          className="rail-bar-btn"
          disabled={nav.at <= 0}
          title={t("browser.back")}
          aria-label={t("browser.back")}
          onClick={() => move(nav.at - 1)}
        >
          <Glyph d="M10 3.5 5.5 8l4.5 4.5" />
        </button>
        <button
          type="button"
          className="rail-bar-btn"
          disabled={nav.at >= nav.urls.length - 1}
          title={t("browser.forward")}
          aria-label={t("browser.forward")}
          onClick={() => move(nav.at + 1)}
        >
          <Glyph d="M6 3.5 10.5 8 6 12.5" />
        </button>
        <button
          type="button"
          className="rail-bar-btn"
          disabled={verdict !== "yes"}
          title={t("browser.reload")}
          aria-label={t("browser.reload")}
          onClick={() => setReloads(reloads + 1)}
        >
          <Glyph d="M12.5 8a4.5 4.5 0 1 1-1.4-3.3M12.5 2.5v2.7H9.8" />
        </button>
        <input
          className="browser-url mono"
          value={draft}
          placeholder={t("browser.placeholder")}
          aria-label={t("browser.address")}
          aria-invalid={invalid}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          inputMode="url"
          onChange={(e) => setDraft(e.target.value)}
        />
        {/* The way out when a page refuses to be framed, or cannot be: it works for every address. */}
        {url ? (
          <a
            className="rail-bar-btn"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title={t("browser.openTab")}
            aria-label={t("browser.openTab")}
          >
            <Glyph d={OPEN_TAB} />
          </a>
        ) : (
          <button type="button" className="rail-bar-btn" disabled aria-label={t("browser.openTab")}>
            <Glyph d={OPEN_TAB} />
          </button>
        )}
      </form>
      {verdict === "yes" ? (
        <iframe
          key={`${url}#${reloads}`}
          className="browser-frame"
          src={url}
          title={url}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          referrerPolicy="no-referrer"
        />
      ) : (
        <p className="side-empty">{message}</p>
      )}
    </div>
  )
}
