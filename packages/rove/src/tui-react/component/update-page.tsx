/** @jsxImportSource @opentui/react */
/**
 * In-workspace update details page, mounted as an in-place swap: close
 * (q/esc/Ctrl+C/[Close]) calls `onClose()`. After a successful update
 * `runUpdater()` still destroys the renderer and exits, since the process is
 * replaced; a status line is shown first so the workspace doesn't vanish
 * unexplained.
 */

import { TextAttributes } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { useEffect, useState } from "react"
import { openWithSystemViewer } from "../../lib/open-external.ts"
import {
  CURRENT_VERSION,
  type ReleaseNotesRangeItem,
  UPDATE_COMMAND,
  type UpdateInfo,
  checkLatestVersion,
  fetchReleaseNotesRange,
  releasePageUrl,
} from "../../version.ts"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { pageCloseBindings, useBindings } from "../lib/keymap"
import { resolveRowSelectionChrome } from "../ui/row-selection-chrome"
import { ReleaseNotesBody } from "./release-notes"
import { runShellUpdater } from "./run-updater.ts"

type ActionId = "update" | "release" | "close"

export function UpdatePage(props: { onClose: () => void }) {
  const { theme } = useTheme()
  const t = useT()
  const renderer = useRenderer()
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  /**
   * Whether the registry check ANSWERED. `checkLatestVersion` returns null on
   * fetch failure and when suppressed, so `info === null` alone can't tell
   * "could not look" from "up to date".
   */
  const [checked, setChecked] = useState(false)
  const [releaseNotes, setReleaseNotes] = useState<ReleaseNotesRangeItem[]>([])
  const [loadingNotes, setLoadingNotes] = useState(true)
  /**
   * Starts on "close", NOT "update": `enter` on "Update now" before the
   * registry answers could DOWNGRADE when `latest < current` (stale dist-tag,
   * local build). `load()` promotes it only once `hasUpdate` is true.
   */
  const [selected, setSelected] = useState<ActionId>("close")
  const [status, setStatus] = useState<string | null>(null)

  const latest = info?.latest ?? CURRENT_VERSION
  const latestUnknown = checked && info === null
  const hasUpdate = info?.hasUpdate === true
  /** The registry answered, and it answered "nothing newer". */
  const upToDate = checked && info !== null && !hasUpdate
  const releaseUrl = releaseNotes[0]?.url ?? releasePageUrl(latest)
  const actions: ReadonlyArray<{ id: ActionId; key: string; label: string; detail: string }> = [
    // Offered only when there IS a newer release.
    ...(hasUpdate
      ? [{ id: "update" as const, key: "U", label: t("update.actions.updateNow"), detail: UPDATE_COMMAND }]
      : []),
    {
      id: "release",
      key: "R",
      label: t("update.actions.openRelease"),
      detail: releaseUrl ?? t("update.releaseUrlUnavailable"),
    },
    { id: "close", key: "Q", label: t("update.actions.close"), detail: t("update.actions.closeDetail") },
  ]

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function load(): Promise<void> {
    // Nothing to catch: `checkLatestVersion` answers null on fetch errors
    // (`checked` turns that into "could not reach the registry"), and
    // `fetchReleaseNotesRange` answers [].
    const next = await checkLatestVersion({ force: true })
    setInfo(next)
    setChecked(true)
    if (next?.hasUpdate) setSelected("update")
    // Only a FORWARD range has notes; a backwards one would read as a failed fetch.
    const fetched = next?.hasUpdate
      ? await fetchReleaseNotesRange({ current: CURRENT_VERSION, latest: next.latest })
      : []
    setReleaseNotes(fetched)
    setLoadingNotes(false)
  }

  function move(delta: number): void {
    const ids = actions.map((a) => a.id)
    const index = ids.indexOf(selected)
    const next = (index + delta + ids.length) % ids.length
    setSelected(ids[next] ?? "close")
  }

  function activate(id: ActionId = selected): void {
    if (id === "close") {
      props.onClose()
      return
    }
    // `u` stays bound, but with no newer release there is nothing to run.
    if (id === "update" && !hasUpdate) return
    if (id === "release") {
      setStatus(openWithSystemViewer(releaseUrl) ? t("update.statusReleaseOpened") : t("update.statusReleaseError"))
      return
    }
    void runUpdater()
  }

  async function runUpdater(): Promise<void> {
    setStatus(t("update.statusRunningUpdater"))
    await new Promise((resolve) => setTimeout(resolve, 30))
    await runShellUpdater({ renderer, t, targetLabel: latest, command: UPDATE_COMMAND })
  }

  useBindings(() => ({
    bindings: [
      { key: "up", cmd: () => move(-1) },
      { key: "down", cmd: () => move(1) },
      { key: "k", cmd: () => move(-1) },
      { key: "j", cmd: () => move(1) },
      { key: "return", cmd: () => activate() },
      { key: "u", cmd: () => activate("update") },
      { key: "r", cmd: () => activate("release") },
      ...pageCloseBindings(() => activate("close")),
    ],
  }))

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
          {t("update.pageTitle")}
        </text>
        <text fg={theme.textMuted} wrapMode="none" onMouseUp={() => activate("close")}>
          {t("update.closeHint")}
        </text>
      </box>

      <box flexDirection="row" gap={2} flexShrink={0} paddingTop={1}>
        <text fg={theme.textMuted} wrapMode="none">
          {t("update.current")}
        </text>
        <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none">
          v{CURRENT_VERSION}
        </text>
        <text fg={theme.textMuted} wrapMode="none">
          {t("update.latest")}
        </text>
        {/* A failed lookup must not read as "you are up to date": those two
            used to be the same green `v{latest}` pixels. Muted prose instead
            of a version number, since there IS no known latest version. */}
        {latestUnknown ? (
          <text fg={theme.textMuted} attributes={TextAttributes.BOLD} wrapMode="none">
            {t("update.latestUnknown")}
          </text>
        ) : (
          <text fg={hasUpdate ? theme.warning : theme.success} attributes={TextAttributes.BOLD} wrapMode="none">
            v{latest}
          </text>
        )}
      </box>

      {/* Green-vs-amber on the version number was the ONLY thing that ever
          said "nothing to install". A colour is not a sentence. */}
      {upToDate ? (
        <box flexShrink={0} paddingTop={1}>
          <text fg={theme.success} wrapMode="word">
            {t("update.upToDate")}
          </text>
        </box>
      ) : null}

      <box flexDirection="column" flexShrink={0} paddingTop={1} gap={0}>
        {actions.map((action) => {
          // Shared cursor chrome (▌ + tint, no fill under transparency): a
          // `primary` bar on this full-window page paints over the wallpaper.
          const cursor = selected === action.id
          const chrome = resolveRowSelectionChrome(theme, { cursor })
          return (
            <box
              key={action.id}
              flexDirection="row"
              gap={0}
              backgroundColor={chrome.backgroundColor}
              onMouseUp={() => activate(action.id)}
            >
              <text fg={chrome.markerColor} wrapMode="none">
                {chrome.marker}
              </text>
              <box flexDirection="row" gap={1} flexGrow={1} paddingLeft={1} paddingRight={1}>
                <box width={4} flexShrink={0}>
                  <text fg={theme.accent} attributes={TextAttributes.BOLD} wrapMode="none">
                    [{action.key}]
                  </text>
                </box>
                <box width={14} flexShrink={0}>
                  <text fg={theme.text} attributes={cursor ? TextAttributes.BOLD : undefined} wrapMode="none">
                    {action.label}
                  </text>
                </box>
                <text fg={theme.textMuted} wrapMode="word">
                  {action.detail}
                </text>
              </box>
            </box>
          )
        })}
      </box>

      {status ? (
        <text fg={theme.info} wrapMode="word">
          {status}
        </text>
      ) : null}

      {hasUpdate ? (
        <box flexShrink={0} paddingTop={1}>
          <text fg={theme.textMuted} attributes={TextAttributes.DIM} wrapMode="none">
            {t("update.changesSectionHeader", { from: CURRENT_VERSION, to: latest })}
          </text>
        </box>
      ) : null}
      <scrollbox
        flexGrow={1}
        flexShrink={1}
        stickyScroll={false}
        verticalScrollbarOptions={{
          trackOptions: { foregroundColor: "transparent" },
        }}
      >
        <box flexDirection="column" paddingRight={1} paddingBottom={1} gap={0}>
          {loadingNotes ? <text fg={theme.textMuted}>{t("update.loadingNotes")}</text> : null}
          {/* Only a real fetch can fail. With nothing newer to fetch, this
              line was reporting a failure that never happened. */}
          {!loadingNotes && hasUpdate && releaseNotes.length === 0 ? (
            <text fg={theme.textMuted} wrapMode="word">
              {t("update.notesUnavailable")}
            </text>
          ) : null}
          {releaseNotes.map((release) => (
            <box key={release.version} flexDirection="column" paddingBottom={1} gap={0}>
              <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none">
                v{release.version}
              </text>
              <ReleaseNotesBody body={release.body} />
            </box>
          ))}
        </box>
      </scrollbox>
    </box>
  )
}
