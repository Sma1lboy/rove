/** @jsxImportSource @opentui/react */
/**
 * In-workspace update details page.
 *
 * `onClose` seam (daemon issue #23 remainder): `UpdatePage` now takes an
 * `{ onClose }` prop — same shape as `WorktreesPage` — so the pure-tui
 * workspace host mounts it as an in-place swap. The close
 * ("q"/esc/Ctrl+C/[Close] action)
 * path calls `onClose()` instead of `process.exit(0)`. The post-update
 * self-replace exit is UNCHANGED: `runUpdater()` still destroys the
 * renderer and `process.exit(code)`s after the shell updater completes —
 * an embedded swap can't survive that, so it stays, with a status line
 * surfaced first so the workspace doesn't vanish without explanation.
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
import { runShellUpdater } from "./run-updater.ts"

type ActionId = "update" | "release" | "close"

export function releaseBodyLines(body: string): string[] {
  return body
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

export function UpdatePage(props: { onClose: () => void }) {
  const { theme } = useTheme()
  const t = useT()
  const renderer = useRenderer()
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  /**
   * Whether the registry check ANSWERED — distinct from what it answered.
   * `checkLatestVersion` returns null both when the fetch fails (offline, npm
   * down, timeout) and when it is suppressed, so `info === null` alone could
   * not tell "we could not look" from "you are up to date". It rendered the
   * failure as a GREEN latest = CURRENT_VERSION: an affirmative claim built
   * out of a network error.
   */
  const [checked, setChecked] = useState(false)
  const [releaseNotes, setReleaseNotes] = useState<ReleaseNotesRangeItem[]>([])
  const [loadingNotes, setLoadingNotes] = useState(true)
  const [selected, setSelected] = useState<ActionId>("update")
  const [status, setStatus] = useState<string | null>(null)

  const latest = info?.latest ?? CURRENT_VERSION
  const latestUnknown = checked && info === null
  const releaseUrl = releaseNotes[0]?.url ?? releasePageUrl(latest)
  const actions: ReadonlyArray<{ id: ActionId; key: string; label: string; detail: string }> = [
    { id: "update", key: "U", label: t("update.actions.updateNow"), detail: UPDATE_COMMAND },
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
    // `checkLatestVersion` swallows its own fetch errors and answers null, so
    // there is nothing to catch here — `checked` is what turns that null into
    // a stated "could not reach the registry" instead of a silent fallback to
    // the current version. `fetchReleaseNotesRange` is equally total (it
    // answers []), and the notes section already says so.
    const next = await checkLatestVersion({ force: true })
    setInfo(next)
    setChecked(true)
    const latestVersion = next?.latest ?? CURRENT_VERSION
    const fetched = await fetchReleaseNotesRange({ current: CURRENT_VERSION, latest: latestVersion })
    setReleaseNotes(fetched)
    setLoadingNotes(false)
  }

  function move(delta: number): void {
    const ids = actions.map((a) => a.id)
    const index = ids.indexOf(selected)
    const next = (index + delta + ids.length) % ids.length
    setSelected(ids[next] ?? "update")
  }

  function activate(id: ActionId = selected): void {
    if (id === "close") {
      props.onClose()
      return
    }
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
          q / esc
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
          <text fg={info?.hasUpdate ? theme.warning : theme.success} attributes={TextAttributes.BOLD} wrapMode="none">
            v{latest}
          </text>
        )}
      </box>

      <box flexDirection="column" flexShrink={0} paddingTop={1} gap={0}>
        {actions.map((action) => (
          <box
            key={action.id}
            flexDirection="row"
            gap={1}
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={selected === action.id ? theme.primary : undefined}
            onMouseUp={() => activate(action.id)}
          >
            <box width={4} flexShrink={0}>
              <text
                fg={selected === action.id ? theme.selectedListItemText : theme.accent}
                attributes={TextAttributes.BOLD}
                wrapMode="none"
              >
                [{action.key}]
              </text>
            </box>
            <box width={14} flexShrink={0}>
              <text fg={selected === action.id ? theme.selectedListItemText : theme.text} wrapMode="none">
                {action.label}
              </text>
            </box>
            <text fg={selected === action.id ? theme.selectedListItemText : theme.textMuted} wrapMode="word">
              {action.detail}
            </text>
          </box>
        ))}
      </box>

      {status ? (
        <text fg={theme.info} wrapMode="word">
          {status}
        </text>
      ) : null}

      <box flexShrink={0} paddingTop={1}>
        <text fg={theme.textMuted} attributes={TextAttributes.DIM} wrapMode="none">
          {t("update.changesSectionHeader", { from: CURRENT_VERSION, to: latest })}
        </text>
      </box>
      <scrollbox
        flexGrow={1}
        flexShrink={1}
        stickyScroll={false}
        verticalScrollbarOptions={{
          trackOptions: { backgroundColor: theme.background, foregroundColor: theme.borderActive },
        }}
      >
        <box flexDirection="column" paddingRight={1} paddingBottom={1} gap={0}>
          {loadingNotes ? <text fg={theme.textMuted}>{t("update.loadingNotes")}</text> : null}
          {!loadingNotes && releaseNotes.length === 0 ? (
            <text fg={theme.textMuted} wrapMode="word">
              {t("update.notesUnavailable")}
            </text>
          ) : null}
          {releaseNotes.map((release) => (
            <box key={release.version} flexDirection="column" paddingBottom={1} gap={0}>
              <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none">
                v{release.version}
              </text>
              {releaseBodyLines(release.body).map((line, i) => (
                <text key={`${i}:${line}`} fg={theme.textMuted} wrapMode="word">
                  {line}
                </text>
              ))}
            </box>
          ))}
        </box>
      </scrollbox>
    </box>
  )
}
