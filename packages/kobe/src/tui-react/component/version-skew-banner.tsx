/** @jsxImportSource @opentui/react */
/**
 * The workspace's two top-of-window daemon banners, and the strip they share.
 *
 * Both are a thin full-width strip (accent rule + BOLD CAPS label + one-line
 * action hint) that auto-hides once the condition clears. They differ in
 * severity and in what they mean for what is on screen:
 *
 *   - {@link VersionSkewBanner} — amber. The daemon answers fine, it is just
 *     an older BUILD than this process (React port of
 *     `src/tui/component/version-skew-banner.tsx`, issue #15 G3).
 *   - {@link DaemonDownBanner} — red. The socket is DOWN, so every daemon-fed
 *     surface on screen is a photograph of the last good snapshot.
 *
 * Theme tokens only, engine-neutral copy. React canon: props are plain
 * values, not Accessors.
 */

import { TextAttributes } from "@opentui/core"
import type { RGBA } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"

/**
 * The strip both banners are: an accent rule, a BOLD CAPS label, one line of
 * action hint. Extracted when the daemon-disconnect banner needed the exact
 * same shape — two hand-copied versions would drift the moment either got a
 * padding tweak.
 */
function BannerStrip(props: { tone: RGBA; title: string; hint: string; width: number }) {
  const { theme } = useTheme()
  // Accent rule spans the strip, clamped to the pane width minus the 1-cell
  // selection gutter; a small floor keeps it visible on a very narrow pane.
  const ruleWidth = Math.max(4, props.width - 2)
  return (
    // flexShrink={0} so the strip never gets squeezed away; it owns its own
    // rows at the very top of the pane.
    <box flexDirection="column" flexShrink={0} paddingLeft={1} paddingRight={1} paddingBottom={1}>
      {/* The accent rule — a bar of `▔` (upper block) so it reads as a thin
          rule above the message, not a heavy fill. */}
      <text fg={props.tone} wrapMode="none">
        {"▔".repeat(ruleWidth)}
      </text>
      <box flexDirection="row" gap={1}>
        <text fg={props.tone} attributes={TextAttributes.BOLD} wrapMode="none">
          {props.title}
        </text>
      </box>
      <box flexDirection="row" gap={1}>
        <text fg={theme.text} wrapMode="word">
          {props.hint}
        </text>
      </box>
    </box>
  )
}

export type DaemonDownBannerProps = {
  /** True while the daemon socket is DOWN (`connectionStateSignal`). */
  down: boolean
  /** Available width (cells) so the accent rule fills the strip. */
  width: number
}

/**
 * Daemon-disconnect banner — the ONE consumer of
 * `RemoteOrchestrator.connectionStateSignal()`.
 *
 * The signal was accurate and immediate from the day it was written and had
 * zero production readers: every page swallowed its own failed read and kept
 * painting the last good snapshot, so a dead daemon rendered as a healthy
 * schedule with a "fires in 12 minutes" countdown. One banner at the top of
 * the workspace answers that for every page at once, which is why the fix is
 * NOT a catch block per page — the next page would omit it again.
 *
 * Scoped to DISCONNECTED, not to "a read failed". A single failed RPC against
 * a live daemon is a transient the reconnect path never sees; only the socket
 * being down means everything on screen is a photograph.
 */
export function DaemonDownBanner(props: DaemonDownBannerProps) {
  const { theme } = useTheme()
  const t = useT()
  if (!props.down) return null
  return (
    <BannerStrip
      tone={theme.error}
      title={t("workspace.daemonDown.title")}
      hint={t("workspace.daemonDown.hint")}
      width={props.width}
    />
  )
}

export type VersionSkewBannerProps = {
  /** True when the daemon is running a different build than this process. */
  stale: boolean
  /** The daemon's reported build version (e.g. "0.7.3"), or null if unknown. */
  daemonVersion: string | null
  /** This process's own build version (e.g. "0.7.4"). */
  clientVersion: string
  /** Available width (cells) so the accent rule fills the strip. */
  width: number
}

export function VersionSkewBanner(props: VersionSkewBannerProps) {
  const { theme } = useTheme()
  const t = useT()
  if (!props.stale) return null
  // One-line action hint: terse + actionable, naming both versions and the
  // two commands that fix it (same copy as the Solid `versionSkewHint`).
  const daemon = props.daemonVersion ? `v${props.daemonVersion}` : t("update.skew.olderBuild")
  return (
    <BannerStrip
      tone={theme.warning}
      title={t("update.skew.title")}
      hint={t("update.skew.hint", { daemon, clientVersion: props.clientVersion })}
      width={props.width}
    />
  )
}
