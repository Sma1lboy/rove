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
 * {@link SkillBanner} — accent; an engine set up here has no Rove agent skill.
 * Not dismissible: it stays until the skill is installed. Clicking it installs.
 *
 * Do NOT add a socket-disconnect banner: Rove works with the daemon down and
 * the reconnect loop recovers most drops in under a second, so there is
 * nothing to act on.
 */

import { TextAttributes } from "@opentui/core"
import type { RGBA } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"

/** One row: the label in the banner's tone, then what to do about it. */
function BannerStrip(props: { tone: RGBA; title: string; hint: string; onPress?: () => void }) {
  const { theme } = useTheme()
  return (
    <box flexShrink={0} paddingLeft={1} paddingRight={1} onMouseUp={props.onPress}>
      <text wrapMode="word">
        <span fg={props.tone} attributes={TextAttributes.BOLD}>
          ▎{props.title}
        </span>
        <span fg={theme.textMuted}>
          {"  "}
          {props.hint}
        </span>
      </text>
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
  return <BannerStrip tone={theme.warning} title={t("update.skew.title")} hint={hint} />
}

export type StaleInstallBannerProps = {
  /** The reconnect loop's terminal error message, or null while all is well. */
  message: string | null
}

export function StaleInstallBanner(props: StaleInstallBannerProps) {
  const { theme } = useTheme()
  const t = useT()
  if (!props.message) return null
  return <BannerStrip tone={theme.error} title={t("update.staleInstall.title")} hint={t("update.staleInstall.hint")} />
}

export type SkillBannerProps = {
  /** Engines lacking the skill; empty hides the banner. */
  engines: readonly string[]
  /** What the last install from the banner could not write. */
  error: string | null
  onInstall: () => void
}

export function SkillBanner(props: SkillBannerProps) {
  const { theme } = useTheme()
  const t = useT()
  if (props.engines.length === 0) return null
  const hint = props.error
    ? t("settings.engines.skill.failed", { reason: props.error })
    : t("settings.engines.skill.bannerHint", { engines: props.engines.join(", ") })
  return (
    <BannerStrip
      tone={props.error ? theme.error : theme.primary}
      title={t("settings.engines.skill.bannerTitle")}
      hint={hint}
      onPress={props.onInstall}
    />
  )
}
