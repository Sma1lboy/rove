/** @jsxImportSource @opentui/react */
/**
 * The workspace's top-of-window daemon banners. A banner earns its place only
 * for a condition that persists until someone acts.
 *
 * {@link VersionSkewBanner} — amber; the daemon runs a different build than
 * this process. Auto-hides once that clears. The hint offers the one chord
 * that fixes it, falling back to the two commands only when the chord is
 * unbound.
 *
 * {@link StaleInstallBanner} — red; this process runs from a deleted install
 * and can never start a daemon again. The action is reinstalling.
 *
 * Do NOT add a socket-disconnect banner: Rove works with the daemon down and
 * the reconnect loop recovers most drops in under a second, so there is
 * nothing to act on.
 */

import { TextAttributes } from "@opentui/core"
import type { RGBA } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"

/** Accent rule, bold caps label, one line of action hint. */
function BannerStrip(props: { tone: RGBA; title: string; hint: string; width: number }) {
  const { theme } = useTheme()
  // Pane width minus the 1-cell selection gutter; floor keeps it visible when narrow.
  const ruleWidth = Math.max(4, props.width - 2)
  return (
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
  /** Live `app.refresh` chord, or null when unavailable/unbound (hint names the commands). */
  refreshChord?: string | null
  /** Available width (cells) so the accent rule fills the strip. */
  width: number
}

export function VersionSkewBanner(props: VersionSkewBannerProps) {
  const { theme } = useTheme()
  const t = useT()
  if (!props.stale) return null
  const daemon = props.daemonVersion ? `v${props.daemonVersion}` : t("update.skew.olderBuild")
  const params = { daemon, clientVersion: props.clientVersion }
  const hint = props.refreshChord
    ? t("update.skew.hint", { ...params, keys: props.refreshChord })
    : t("update.skew.hintNoKey", params)
  return <BannerStrip tone={theme.warning} title={t("update.skew.title")} hint={hint} width={props.width} />
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
