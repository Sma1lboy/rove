/**
 * The side panel's Browser: an address bar over an iframe. A frame only shows what the browser can
 * reach and the site lets a page embed, and a refusal is silent, so the open-in-a-new-tab button
 * beside the address always works. Back and forward walk the addresses typed here; moves inside the
 * frame are the frame's own (a cross-origin page's history cannot be read).
 */

import { useEffect, useState } from "react"
import { canFrame, frameNote, isLoopbackHost, normalizeUrl } from "./browser-url.ts"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { type PanelItem, browserUrl } from "./panel-model.ts"
import { useStore } from "./store.ts"
import { BROWSER, BROWSER_BAR, BROWSER_FRAME, BROWSER_URL, SIDE_EMPTY, iconButton } from "./ui/panel.ts"
import { useFrameProbe } from "./use-frame-probe.ts"

function Glyph({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const OPEN_TAB = "M6.5 3.5h-3v9h9v-3M9.5 3.5h3v3M12.5 3.5l-5 5"

export function BrowserView({
  model,
  tab,
  onNavigate,
  onStep,
}: {
  model: AppModel
  tab: Extract<PanelItem, { kind: "browser" }>
  onNavigate: (url: string) => void
  onStep: (at: number) => void
}) {
  useLocale()
  const url = browserUrl(tab)
  const [draft, setDraft] = useState(url)
  const [invalid, setInvalid] = useState(false)
  const [reloads, setReloads] = useState(0)
  const peerLocal = useStore(model.client.conn).hello?.peer?.local
  const verdict = url ? canFrame(url, window.location, peerLocal) : null

  // An address set from outside (`rove api panel-show`, back / forward) loads like a typed one.
  useEffect(() => {
    setDraft(url)
    setInvalid(false)
  }, [url])

  const load = (input: string) => {
    const next = normalizeUrl(input)
    // An empty field is nothing to load, not a mistake.
    setInvalid(next === null && input.trim() !== "")
    if (next === null) return
    setDraft(next)
    if (next === url) setReloads(reloads + 1)
    else onNavigate(next)
  }

  // An https page is asked first (`browser.probe`): a site that forbids framing never gets an iframe.
  const host = url ? new URL(url).hostname : ""
  const needsProbe = verdict === "yes" && url.startsWith("https:") && !isLoopbackHost(host)
  const { pending, probe } = useFrameProbe(model.client, url, needsProbe)
  const note = url && verdict ? frameNote(url, verdict, probe) : null
  const framed = verdict === "yes" && !note && !pending
  const message = note
    ? t(`browser.${note.key}`, { host: note.host })
    : verdict === null
      ? invalid
        ? t("browser.invalid")
        : t("browser.empty")
      : null

  return (
    <div className={BROWSER}>
      <form
        className={BROWSER_BAR}
        onSubmit={(e) => {
          e.preventDefault()
          load(draft)
        }}
      >
        <button
          type="button"
          className={iconButton({ small: true })}
          disabled={tab.at <= 0}
          title={t("browser.back")}
          aria-label={t("browser.back")}
          onClick={() => onStep(tab.at - 1)}
        >
          <Glyph d="M10 3.5 5.5 8l4.5 4.5" />
        </button>
        <button
          type="button"
          className={iconButton({ small: true })}
          disabled={tab.at >= tab.urls.length - 1}
          title={t("browser.forward")}
          aria-label={t("browser.forward")}
          onClick={() => onStep(tab.at + 1)}
        >
          <Glyph d="M6 3.5 10.5 8 6 12.5" />
        </button>
        <button
          type="button"
          className={iconButton({ small: true })}
          disabled={!framed}
          title={t("browser.reload")}
          aria-label={t("browser.reload")}
          onClick={() => setReloads(reloads + 1)}
        >
          <Glyph d="M12.5 8a4.5 4.5 0 1 1-1.4-3.3M12.5 2.5v2.7H9.8" />
        </button>
        <input
          className={`browser-url mono ${BROWSER_URL}`}
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
            className={iconButton({ small: true })}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title={t("browser.openTab")}
            aria-label={t("browser.openTab")}
          >
            <Glyph d={OPEN_TAB} />
          </a>
        ) : (
          <button type="button" className={iconButton({ small: true })} disabled aria-label={t("browser.openTab")}>
            <Glyph d={OPEN_TAB} />
          </button>
        )}
      </form>
      {framed ? (
        <iframe
          key={`${url}#${reloads}`}
          className={BROWSER_FRAME}
          src={url}
          title={url}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          referrerPolicy="no-referrer"
        />
      ) : message ? (
        <p className={SIDE_EMPTY}>{message}</p>
      ) : null}
    </div>
  )
}
