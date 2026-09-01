/** @jsxImportSource @opentui/react */
/**
 * The workspace's top-of-window daemon banner.
 *
 * {@link VersionSkewBanner} — amber, a thin full-width strip (accent rule +
 * BOLD CAPS label + one-line action hint) that auto-hides once the condition
 * clears. The daemon answers fine, it is just an older BUILD than this process
 * (React port of `src/tui/component/version-skew-banner.tsx`, issue #15 G3).
 *
 * A red socket-disconnect banner shared this file and was removed: Rove keeps
 * working with the daemon down, and the reconnect loop recovers most drops in
 * under a second, so a full-width alert was interrupting with nothing to act
 * on. Skew is the opposite — it persists until someone restarts the daemon,
 * which is an action, which is why this one stayed.
 *
 * {@link StaleInstallBanner} — red, the same strip, for the one condition
 * that never clears on its own: this process is running from an install that
 * has been deleted, so it can never start a daemon again. That earned a
 * banner on the same test the skew banner passed and the disconnect banner
 * failed — it persists until someone acts, and the action is reinstalling.
 *
 * Theme tokens only, engine-neutral copy. React canon: props are plain
 * values, not Accessors.
 */

import { TextAttributes } from "@opentui/core"
import type { RGBA } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"

/** The strip the banner is: an accent rule, a BOLD CAPS label, one line of
 *  action hint. Kept as its own component so the next banner reuses the shape
 *  instead of hand-copying it. */
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

export type StaleInstallBannerProps = {
  /** The reconnect loop's terminal error message, or null while all is well. */
  message: string | null
  /** Available width (cells) so the accent rule fills the strip. */
  width: number
}

export function StaleInstallBanner(props: StaleInstallBannerProps) {
  const { theme } = useTheme()
  const t = useT()
  if (!props.message) return null
  return (
    <BannerStrip
      tone={theme.error}
      title={t("update.staleInstall.title")}
      hint={t("update.staleInstall.hint")}
      width={props.width}
    />
  )
}
