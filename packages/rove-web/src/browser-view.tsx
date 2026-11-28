/**
 * The side panel's Browser: an address bar over an iframe, or over a file of the task read through the
 * bridge (its path is the address). A frame only shows what the browser can reach and the site lets a
 * page embed, and a refusal is silent, so the open-in-a-new-tab button beside a web address always
 * works. Back and forward walk the addresses opened here; moves inside the frame are the frame's own
 * (a cross-origin page's history cannot be read).
 */

import { useEffect, useRef, useState } from "react"
import { BrowserAnnotate } from "./browser-annotate.tsx"
import { canCapture } from "./browser-capture.ts"
import { type BrowserTab, browserUrl } from "./browser-tabs.ts"
import {
  canFrame,
  elidePath,
  filePath,
  fileShown,
  frameNote,
  isLoopbackHost,
  normalizePath,
  normalizeUrl,
} from "./browser-url.ts"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { usePagePorts } from "./ports-strip.tsx"
import { PreviewHost } from "./preview-host.tsx"
import { useStore } from "./store.ts"
import { Button } from "./ui/button.tsx"
import {
  BROWSER,
  BROWSER_BAR,
  BROWSER_FRAME,
  BROWSER_STAGE,
  BROWSER_URL,
  SIDE_EMPTY,
  SIDE_EMPTY_LIST,
  iconButton,
} from "./ui/panel.ts"
import { ROW_TITLE, rowClass } from "./ui/row.ts"
import { useFrameProbe } from "./use-frame-probe.ts"

function Glyph({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

/** A tab with no address: the pages this task serves, one click each, over the hint. */
function BlankTab(props: { model: AppModel; taskId: string; onOpen: (url: string) => void }) {
  const ports = usePagePorts(props.model, props.taskId)
  return (
    <div className={SIDE_EMPTY}>
      {ports.length > 0 && (
        <div className={SIDE_EMPTY_LIST}>
          {ports.map((p) => (
            <button // ui-ok: a list row in the row recipe (`rowClass`), as in the Files tree
              type="button"
              key={p.port}
              className={rowClass({ size: "file" })}
              title={p.url}
              onClick={() => props.onOpen(p.url)}
            >
              <span className={ROW_TITLE}>{p.command}</span>
              <span className="flex-none text-subtle">{`:${p.port}`}</span>
            </button>
          ))}
        </div>
      )}
      <p>{t(ports.length > 0 ? "browser.empty" : "browser.emptyPorts")}</p>
    </div>
  )
}

const OPEN_TAB = "M6.5 3.5h-3v9h9v-3M9.5 3.5h3v3M12.5 3.5l-5 5"

export function BrowserView({
  model,
  taskId,
  tab,
  root,
  shown,
  restored,
  onClose,
  onNavigate,
  onStep,
}: {
  model: AppModel
  taskId: string
  tab: BrowserTab
  /** The task's directory on its machine: what a file's address is shown under. */
  root: string | undefined
  /** This tab is the one on screen. */
  shown: boolean
  restored: boolean
  onClose: () => void
  onNavigate: (url: string) => void
  onStep: (at: number) => void
}) {
  useLocale()
  const url = browserUrl(tab)
  const path = filePath(url)
  const address = path === null ? url : fileShown(path, root)
  const [draft, setDraft] = useState(address)
  const [problem, setProblem] = useState<"invalid" | "outside" | null>(null)
  const [reloads, setReloads] = useState(0)
  const [annotating, setAnnotating] = useState(false)
  const stage = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLInputElement>(null)
  const peerLocal = useStore(model.client.conn).hello?.peer?.local
  const verdict = url && path === null ? canFrame(url, window.location, peerLocal) : null

  // An address set from outside (`rove api panel-show`, Files, back / forward) loads like a typed one.
  useEffect(() => {
    setDraft(address)
    setProblem(null)
  }, [address])

  // A path's end is the file: a bar too narrow for all of it drops leading folders, never part of a name.
  const [editing, setEditing] = useState(false)
  const [barWidth, setBarWidth] = useState(0)
  useEffect(() => {
    const el = bar.current
    if (!el) return
    const watch = new ResizeObserver(() => setBarWidth(el.clientWidth))
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
  const shownDraft = path === null || editing || !bar.current ? draft : elideToBar(bar.current, draft, barWidth)

  const load = (input: string) => {
    const file = normalizePath(input, root)
    const next = file === "outside" ? null : (file ?? normalizeUrl(input))
    // An empty field is nothing to load, not a mistake.
    setProblem(file === "outside" ? "outside" : next === null && input.trim() !== "" ? "invalid" : null)
    if (next === null) return
    if (next === url) {
      setDraft(address)
      setReloads(reloads + 1)
    } else onNavigate(next)
  }

  // An https page is asked first (`browser.probe`): a site that forbids framing never gets an iframe.
  const host = verdict ? new URL(url).hostname : ""
  const needsProbe = verdict === "yes" && url.startsWith("https:") && !isLoopbackHost(host)
  const { pending, probe } = useFrameProbe(model.client, url, needsProbe)
  const note = url && verdict ? frameNote(url, verdict, probe) : null
  const framed = verdict === "yes" && !note && !pending
  const message = note
    ? t(`browser.${note.key}`, { host: note.host })
    : verdict === null && path === null
      ? t(`browser.${problem ?? "empty"}`)
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
          disabled={!framed && path === null}
          title={t("browser.reload")}
          aria-label={t("browser.reload")}
          onClick={() => setReloads(reloads + 1)}
        >
          <Glyph d="M12.5 8a4.5 4.5 0 1 1-1.4-3.3M12.5 2.5v2.7H9.8" />
        </button>
        <input
          ref={bar}
          className={`browser-url mono ${BROWSER_URL}`}
          value={shownDraft}
          placeholder={t("browser.placeholder")}
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          aria-label={t("browser.address")}
          aria-invalid={problem !== null}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          inputMode="url"
          onChange={(e) => setDraft(e.target.value)}
        />
        {canCapture() && (
          <Button
            variant={annotating && framed ? "iconOn" : "icon"}
            disabled={!framed}
            title={t("browser.annotate")}
            aria-label={t("browser.annotate")}
            aria-pressed={annotating && framed}
            onClick={() => setAnnotating(!annotating)}
          >
            <Glyph d="M3 13l.6-2.6L10.9 3.1l2 2L5.6 12.4zM9.6 4.4l2 2" />
          </Button>
        )}
        {/* The way out when a page refuses to be framed, or cannot be: it works for every address. */}
        {url && path === null ? (
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
      {path !== null ? (
        <PreviewHost
          key={`${path}#${reloads}#${tab.read ?? ""}`}
          model={model}
          view={{ taskId, path, scope: "working", file: true }}
          active={shown}
          restored={restored}
          onClose={onClose}
        />
      ) : framed ? (
        <div ref={stage} className={BROWSER_STAGE}>
          <iframe
            key={`${url}#${reloads}`}
            className={BROWSER_FRAME}
            src={url}
            title={url}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            referrerPolicy="no-referrer"
          />
          {annotating && (
            <BrowserAnnotate
              // Marks belong to the page they were drawn on.
              key={`${url}#${reloads}`}
              model={model}
              taskId={taskId}
              url={url}
              target={stage}
              onClose={() => setAnnotating(false)}
            />
          )}
        </div>
      ) : verdict === null && problem === null ? (
        <BlankTab model={model} taskId={taskId} onOpen={onNavigate} />
      ) : message ? (
        <p className={SIDE_EMPTY}>{message}</p>
      ) : null}
    </div>
  )
}

const measure = document.createElement("canvas").getContext("2d")

function elideToBar(el: HTMLInputElement, text: string, width: number): string {
  const style = getComputedStyle(el)
  const room = width - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)
  if (!measure || !(room > 0)) return text
  measure.font = style.font
  return elidePath(text, (s) => measure.measureText(s).width <= room)
}
