/** @jsxImportSource @opentui/react */
/**
 * "What's new" — the first screen after an upgrade, shown once.
 *
 * Sibling of `UpdatePage`, and deliberately not the same page: Update
 * answers "there is a newer build, do you want it", this one answers "you
 * are already on the new build, here is what changed". So it offers no
 * installer action and no version comparison — only the release notes for
 * the range the user just crossed, and a way out.
 *
 * Zero new chords: `pageCloseBindings` (q / esc / ctrl+c) is the whole
 * keymap, the same exit every other full-window page uses. Nothing here is
 * a gate — the notes load asynchronously and closing works from the first
 * frame, before (and whether or not) GitHub answers.
 *
 * LANGUAGE: the page chrome is translated; the note BODIES are whatever
 * GitHub published, which today is English only. See `docs/TUI.md`
 * §"What's new after an upgrade".
 */

import { TextAttributes } from "@opentui/core"
import { useEffect, useState } from "react"
import { CURRENT_VERSION, type ReleaseNotesRangeItem, fetchReleaseNotesRange, releasePageUrl } from "../../version.ts"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { pageCloseBindings, useBindings } from "../lib/keymap"
import { ReleaseNotesBody } from "./release-notes"

export function WhatsNewPage(props: {
  from: string
  onClose: () => void
  /** Seam for the render track, which must not reach api.github.com. */
  fetchNotes?: typeof fetchReleaseNotesRange
}) {
  const { theme } = useTheme()
  const t = useT()
  const [notes, setNotes] = useState<ReleaseNotesRangeItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    // Total by contract: offline, rate-limited and 500 all answer []. The
    // page states that rather than surfacing an error, and the release URL
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

  useBindings(() => ({ bindings: pageCloseBindings(props.onClose) }))

  const url = notes[0]?.url ?? releasePageUrl(CURRENT_VERSION)

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      backgroundColor={theme.background}
      paddingTop={1}
      paddingLeft={2}
      paddingRight={2}
    >
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none">
          {t("update.whatsNew.pageTitle")}
        </text>
        <text fg={theme.textMuted} wrapMode="none" onMouseUp={props.onClose}>
          {t("update.whatsNew.closeHint")}
        </text>
      </box>

      <box flexShrink={0} paddingTop={1}>
        <text fg={theme.accent} wrapMode="word">
          {t("update.whatsNew.upgraded", { from: props.from, to: CURRENT_VERSION })}
        </text>
      </box>

      <scrollbox
        flexGrow={1}
        flexShrink={1}
        stickyScroll={false}
        verticalScrollbarOptions={{ trackOptions: { foregroundColor: "transparent" } }}
      >
        <box flexDirection="column" paddingTop={1} paddingRight={1} paddingBottom={1} gap={0}>
          {loading ? <text fg={theme.textMuted}>{t("update.loadingNotes")}</text> : null}
          {!loading && notes.length === 0 ? (
            <text fg={theme.textMuted} wrapMode="word">
              {t("update.whatsNew.notesUnavailable")}
            </text>
          ) : null}
          {notes.map((release) => (
            <box key={release.version} flexDirection="column" paddingBottom={1} gap={0}>
              <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none">
                v{release.version}
              </text>
              <ReleaseNotesBody body={release.body} />
            </box>
          ))}
        </box>
      </scrollbox>

      {url ? (
        <box flexShrink={0}>
          <text fg={theme.textMuted} attributes={TextAttributes.DIM} wrapMode="none">
            {t("update.whatsNew.sourceHint", { url })}
          </text>
        </box>
      ) : null}
    </box>
  )
}
