/** @jsxImportSource @opentui/react */
/**
 * "What's new" — the first thing you see after an upgrade, shown once.
 *
 * Sibling of `UpdatePage`, and deliberately not the same surface: Update
 * answers "there is a newer build, do you want it", this one answers "you
 * are already on the new build, here is what changed". So it offers no
 * installer action and no version comparison — only the release notes for
 * the range the user just crossed, and a way out.
 *
 * ## Why a modal and not a page
 *
 * It shipped (#1039) as a full-window page that replaced the workspace,
 * sidebar included. A page is the right shape for something you NAVIGATE to
 * and come back from; this is a single dismissal you were handed on boot.
 * Taking the whole screen for it made the first frame after an upgrade look
 * like Rove had started somewhere else, and hid the task list the user was
 * actually returning to. As a modal over the workspace, the thing you came
 * back for is visible behind the thing you have to acknowledge.
 *
 * ## The shape, decided against OUR dialog grammar
 *
 * The release-notes modal is a well-trodden PRESENTATION: a fixed-size
 * centered modal, dimmed behind, a header carrying a title and a subtitle, a
 * scrollbar down the body, an action in the footer. What we take and what we
 * leave is decided against `docs/design/dialogs.md`, because a What's New
 * modal wearing borrowed chrome would be the only dialog in Rove that looked
 * like that:
 *
 *   - SIZE — `medium` (80 cells) is already our default card and is already
 *     the conventional width. A fixed 24-row height we do NOT take: our card is
 *     content-sized under a `maxHeight`, so a two-line note draws a small
 *     card and a six-version range grows to the cap and scrolls. A fixed
 *     height would pad the first and clip the second.
 *   - SCROLL — yes, and through the same `scrollbox` + visible scrollbar the
 *     help dialog and the field-notes reader already use.
 *   - HEADER — title plus subtitle is our header too (the field-notes
 *     reader's repo line, the help dialog's scope line), so it carries over
 *     unchanged.
 *   - FOOTER BUTTON — no. `DialogActions` is for a dialog whose commit has a
 *     focusable confirm field; one that closes with esc "states the verb in
 *     its legend instead — a button nothing can focus would be a fourth
 *     thing to explain" (`ui/dialog-parts.tsx`). This dialog commits
 *     nothing, so it gets the legend.
 *
 * ZERO new chords: the native navigation set (arrows / page / home / end)
 * plus the dismiss keys the page already had. `escape` and `ctrl+c` come
 * from the DialogProvider — do not re-bind them here — so only `q` is ours.
 * `end` matters: a six-version upgrade is longer than any card, and the
 * reader has to be able to reach the bottom of it.
 *
 * LANGUAGE: the chrome is translated; the note BODIES are whatever GitHub
 * published, which today is English only. See `docs/TUI.md`
 * §"What's new after an upgrade".
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
    // Total by contract: offline, rate-limited and 500 all answer []. The
    // dialog states that rather than surfacing an error, and the release URL
    // below stays useful either way.
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

  // Native navigation only — the same set the help dialog binds, for the
  // same reason (docs/KEYBINDINGS.md pane-scope rules: a reader must be
  // keyboard-reachable without inventing a chord).
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
      // `escape` and `ctrl+c` are the DialogProvider's; `q` is the one the
      // page had that a dialog does not get for free.
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

/**
 * Open it. `dialog.replace` rather than `push`: this arrives on boot, before
 * anything else could be on the stack, and it is a single dismissal — there
 * is nothing underneath it to come back to.
 */
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
    // Fires for every route out — `q`, esc, ctrl+c, a click on the backdrop
    // — so the host clears its one-shot state exactly once, whichever the
    // user took.
    opts.onClosed,
  )
  dialog.setSize("medium")
}

export const WhatsNewDialog = { show }

/**
 * Hand the boot-time "you just upgraded" signal to the dialog stack, once.
 *
 * A hook rather than a call site in the page router because this is no
 * longer a page: `renderFullWindowPage` had it first in its precedence order
 * purely so it could beat the surfaces a chord opens, and a modal outranks
 * all of them by being a modal.
 */
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
