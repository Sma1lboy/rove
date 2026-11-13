/**
 * Marks over the Browser's page: pen, box and text, drawn on a layer of ours above the frame (the page
 * itself is out of reach). "Add to chat" takes a picture of the frame with the marks on it and types
 * its path into the task's engine, as a dropped image does.
 */

import { type MouseEvent, type PointerEvent, type RefObject, useState } from "react"
import { captureElement } from "./browser-capture.ts"
import { browserHost } from "./browser-tabs.ts"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { liveHandle } from "./term-pool.ts"
import { dropFiles } from "./terminal-view.tsx"
import { activeStream, toast } from "./ui.ts"
import { Button } from "./ui/button.tsx"
import { ANNOTATE_BAR, ANNOTATE_INPUT, ANNOTATE_LAYER } from "./ui/panel.ts"

type Tool = "pen" | "box" | "text"
type Mark =
  | { readonly kind: "pen"; readonly d: string }
  | { readonly kind: "box"; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly kind: "text"; readonly x: number; readonly y: number; readonly text: string }

const TOOLS: readonly { tool: Tool; d: string }[] = [
  { tool: "pen", d: "M3 13l.6-2.6L10.9 3.1l2 2L5.6 12.4zM9.6 4.4l2 2" },
  { tool: "box", d: "M3 4h10v8H3z" },
  { tool: "text", d: "M4 4h8M8 4v8.5" },
]

function MarkShape({ mark }: { mark: Mark }) {
  if (mark.kind === "pen") return <path d={mark.d} />
  if (mark.kind === "box") return <rect x={mark.x} y={mark.y} width={mark.w} height={mark.h} rx={2} />
  return (
    <text x={mark.x} y={mark.y} className="fill-accent stroke-none font-mono text-body font-semibold">
      {mark.text}
    </text>
  )
}

export function BrowserAnnotate({
  model,
  taskId,
  url,
  target,
  onClose,
}: {
  model: AppModel
  taskId: string
  url: string
  /** What the picture is cut to: the frame and this layer. */
  target: RefObject<HTMLDivElement | null>
  onClose: () => void
}) {
  const [tool, setTool] = useState<Tool>("pen")
  const [marks, setMarks] = useState<readonly Mark[]>([])
  const [draft, setDraft] = useState<Mark | null>(null)
  const [typing, setTyping] = useState<{ x: number; y: number } | null>(null)
  const [busy, setBusy] = useState(false)

  const at = (e: PointerEvent<SVGSVGElement> | MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    return { x: Math.round(e.clientX - box.left), y: Math.round(e.clientY - box.top) }
  }
  const down = (e: PointerEvent<SVGSVGElement>) => {
    const { x, y } = at(e)
    // Text is placed on the click: this press first takes focus from a field being typed in, which keeps its text.
    if (tool === "text") return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDraft(tool === "pen" ? { kind: "pen", d: `M${x} ${y}` } : { kind: "box", x, y, w: 0, h: 0 })
  }
  const move = (e: PointerEvent<SVGSVGElement>) => {
    if (!draft) return
    const { x, y } = at(e)
    if (draft.kind === "pen") setDraft({ kind: "pen", d: `${draft.d} L${x} ${y}` })
    // The box keeps its first corner; a drag up or left is left for the pen.
    else if (draft.kind === "box") setDraft({ ...draft, w: Math.max(0, x - draft.x), h: Math.max(0, y - draft.y) })
  }
  const up = () => {
    if (draft && (draft.kind !== "box" || (draft.w > 2 && draft.h > 2))) setMarks([...marks, draft])
    setDraft(null)
  }
  const commitText = (text: string) => {
    if (typing && text.trim()) setMarks([...marks, { kind: "text", ...typing, text: text.trim() }])
    setTyping(null)
  }

  const send = async () => {
    const stream = activeStream.get()
    const handle = stream?.startsWith(`${taskId}::`) ? liveHandle(model.client, stream) : null
    const el = target.current
    if (!handle || !el) {
      toast(t("browser.noEngine"), "error")
      return
    }
    // The bar is hidden while the browser asks, so it is not in the picture.
    setBusy(true)
    try {
      await dropFiles(model.client, handle, [await captureElement(el, `browser-${browserHost(url)}.png`)])
      onClose()
    } catch (err) {
      // Saying no to the browser's question is an answer, not a failure.
      if (!(err instanceof DOMException && err.name === "NotAllowedError")) {
        toast(t("browser.captureFailed", { error: err instanceof Error ? err.message : String(err) }), "error")
      }
      setBusy(false)
    }
  }

  return (
    <>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: drawing is a pointer's job; the bar's buttons take keys */}
      <svg
        className={ANNOTATE_LAYER}
        aria-label={t("browser.annotate")}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onClick={(e) => tool === "text" && setTyping(at(e))}
      >
        <title>{t("browser.annotate")}</title>
        {[...marks, ...(draft ? [draft] : [])].map((mark, i) => (
          // Marks are only ever added at the end or dropped from it.
          // biome-ignore lint/suspicious/noArrayIndexKey: the index is the mark's identity
          <MarkShape key={i} mark={mark} />
        ))}
      </svg>
      {typing && (
        <input
          // biome-ignore lint/a11y/noAutofocus: the click that placed it asked to type here
          autoFocus
          key={`${typing.x},${typing.y}`}
          className={ANNOTATE_INPUT}
          style={{ left: typing.x, top: typing.y - 14 }}
          aria-label={t("browser.text")}
          onBlur={(e) => commitText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      )}
      {!busy && (
        <div className={ANNOTATE_BAR}>
          {TOOLS.map((entry) => (
            <Button
              key={entry.tool}
              variant={tool === entry.tool ? "iconOn" : "icon"}
              title={t(`browser.${entry.tool}`)}
              aria-label={t(`browser.${entry.tool}`)}
              aria-pressed={tool === entry.tool}
              onClick={() => setTool(entry.tool)}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d={entry.d} />
              </svg>
            </Button>
          ))}
          <Button
            variant="icon"
            disabled={marks.length === 0}
            title={t("browser.undo")}
            aria-label={t("browser.undo")}
            onClick={() => setMarks(marks.slice(0, -1))}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M5.5 3.5 3 6l2.5 2.5M3 6h6.5a3 3 0 0 1 0 6H7" />
            </svg>
          </Button>
          <Button variant="filled" onClick={() => void send()}>
            {t("browser.addToChat")}
          </Button>
          <Button
            variant="icon"
            title={t("browser.annotateDone")}
            aria-label={t("browser.annotateDone")}
            onClick={onClose}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </Button>
        </div>
      )}
    </>
  )
}
