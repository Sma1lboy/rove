/** @jsxImportSource @opentui/react */
/**
 * "What's new" — release notes for the version range just crossed, shown
 * once after an upgrade. Unlike `UpdatePage` it offers no installer action.
 *
 * A modal, not a page: a full-window page hid the task list the user was
 * returning to. Shape follows `docs/design/dialogs.md`:
 *   - SIZE — `medium`, content-sized under `maxHeight` (no fixed height: it
 *     would pad a short note and clip a long range).
 *   - FOOTER — a legend, no button: `DialogActions` is for dialogs with a
 *     focusable confirm, and this one commits nothing.
 *
 * No new chords: `escape`/`ctrl+c` come from the DialogProvider (don't
 * re-bind), so only `q` plus native navigation are ours. `end` matters — a
 * multi-version range is longer than any card.
 *
 * Chrome is translated; note bodies are whatever GitHub published (English).
 * See `docs/TUI.md` §"What's new after an upgrade".
 */

import { TextAttributes } from "@opentui/core"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useEffect, useRef, useState } from "react"
import { CURRENT_VERSION, type ReleaseNotesRangeItem, fetchReleaseNotesRange, releasePageUrl } from "../../version.ts"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { useBindings } from "../lib/keymap"
import { type DialogContext, useDialog, useDialogPaddingX } from "../ui/dialog"
import { ReleaseNotesBody } from "./release-notes"

export function WhatsNewDialogView(props: {
  from: string
  onClose: () => void
  /** Seam for the render track, which must not reach api.github.com. */
  fetchNotes?: typeof fetchReleaseNotesRange
}) {
  const { theme } = useTheme()
  const t = useT()
  const padX = useDialogPaddingX()
  const [notes, setNotes] = useState<ReleaseNotesRangeItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    // Total by contract: offline, rate-limited and 500 all answer [].
    const load = props.fetchNotes ?? fetchReleaseNotesRange
    void load({ current: props.from, latest: CURRENT_VERSION }).then((fetched) => {
      if (!live) return
      setNotes(fetched)
      setLoading(false)
    })
    return () => {
      live = false
    }
  }, [props.from, props.fetchNotes])

  const scrollRef = useRef<ScrollBoxRenderable | null>(null)
  const scrollBy = (lines: number): void => {
    const scroll = scrollRef.current
    if (!scroll) return
    scroll.scrollTo({ x: 0, y: Math.max(0, scroll.scrollTop + lines) })
  }
  const scrollToEdge = (edge: "top" | "bottom"): void => {
    const scroll = scrollRef.current
    if (!scroll) return
    scroll.scrollTo({ x: 0, y: edge === "top" ? 0 : Number.MAX_SAFE_INTEGER })
  }

  useBindings(() => ({
    bindings: [
      // `escape` and `ctrl+c` are the DialogProvider's.
      { key: "q", cmd: props.onClose },
      { key: "up", cmd: () => scrollBy(-1) },
      { key: "down", cmd: () => scrollBy(1) },
      { key: "pageup", cmd: () => scrollBy(-(scrollRef.current?.viewport.height ?? 10)) },
      { key: "pagedown", cmd: () => scrollBy(scrollRef.current?.viewport.height ?? 10) },
      { key: "home", cmd: () => scrollToEdge("top") },
      { key: "end", cmd: () => scrollToEdge("bottom") },
    ],
  }))

  const url = notes[0]?.url ?? releasePageUrl(CURRENT_VERSION)

  return (
    <box paddingLeft={padX} paddingRight={padX} gap={1} flexShrink={1}>
      <box flexDirection="column" gap={0} flexShrink={0}>
        <box flexDirection="row" justifyContent="space-between">
          <text attributes={TextAttributes.BOLD} fg={theme.text} wrapMode="none">
            {t("update.whatsNew.title")}
          </text>
          {/* Corner, not a header line of its own: the scroll hint is about
              exactly the fold another row would eat into. Always shown — the
              keys work whether or not this particular range overflows. */}
          <box flexDirection="row" gap={2} flexShrink={0}>
            <text fg={theme.textMuted} attributes={TextAttributes.DIM} wrapMode="none">
              {t("help.scrollKeys")}
            </text>
            <text fg={theme.textMuted} wrapMode="none" onMouseUp={props.onClose}>
              {t("update.whatsNew.closeHint")}
            </text>
          </box>
        </box>
        {/* Its own row under the title, not beside it: sharing the header row
            with the corner hints left the subtitle ~50 cells and wrapped a
            one-line sentence onto two. */}
        <text fg={theme.accent} wrapMode="word">
          {t("update.whatsNew.upgraded", { from: props.from, to: CURRENT_VERSION })}
        </text>
      </box>
      {/* Long-content dialogs handle their own overflow: flexShrink={1} fits
          the card's maxHeight, the scrollbox owns the scrolling. */}
      <scrollbox
        ref={(r: ScrollBoxRenderable | null) => {
          scrollRef.current = r
        }}
        flexShrink={1}
        flexGrow={1}
        stickyScroll={false}
        verticalScrollbarOptions={{
          trackOptions: { backgroundColor: theme.backgroundDialog, foregroundColor: theme.borderActive },
        }}
      >
        <box flexDirection="column" paddingRight={1} paddingBottom={1} gap={1}>
          {loading ? <text fg={theme.textMuted}>{t("update.loadingNotes")}</text> : null}
          {!loading && notes.length === 0 ? (
            <text fg={theme.textMuted} wrapMode="word">
              {t("update.whatsNew.notesUnavailable")}
            </text>
          ) : null}
          {notes.map((release) => (
            <box key={release.version} flexDirection="column" gap={0}>
              <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none">
                v{release.version}
              </text>
              <ReleaseNotesBody body={release.body} />
            </box>
          ))}
        </box>
      </scrollbox>
      <box paddingBottom={1} flexShrink={0}>
        <text fg={theme.textMuted} attributes={TextAttributes.DIM} wrapMode="none">
          {t("update.whatsNew.sourceHint", { url })}
        </text>
      </box>
    </box>
  )
}

/** `replace`, not `push`: it arrives on boot with nothing underneath to return to. */
function show(
  dialog: DialogContext,
  opts: { from: string; onClosed: () => void; fetchNotes?: typeof fetchReleaseNotesRange },
): void {
  dialog.replace(
    () => (
      <WhatsNewDialogView
        from={opts.from}
        onClose={() => dialog.clear()}
        {...(opts.fetchNotes ? { fetchNotes: opts.fetchNotes } : {})}
      />
    ),
    // Fires on every route out (q, esc, ctrl+c, backdrop click), so the host
    // clears its one-shot state exactly once.
    opts.onClosed,
  )
  dialog.setSize("medium")
}

const WhatsNewDialog = { show }

/** Hand the boot-time "you just upgraded" signal to the dialog stack, once. */
export function useWhatsNewDialog(
  from: string | null,
  onClosed: () => void,
  /** Seam for the render track, which must not reach api.github.com. */
  fetchNotes?: typeof fetchReleaseNotesRange,
): void {
  const dialog = useDialog()
  const opened = useRef(false)
  useEffect(() => {
    if (from === null || opened.current) return
    opened.current = true
    WhatsNewDialog.show(dialog, { from, onClosed, ...(fetchNotes ? { fetchNotes } : {}) })
  }, [from, dialog, onClosed, fetchNotes])
}
