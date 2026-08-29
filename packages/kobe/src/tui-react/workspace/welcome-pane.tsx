/** @jsxImportSource @opentui/react */
/**
 * Zero-tasks welcome panel — the workspace center column's empty state when
 * NO task exists yet (first launch, or everything archived). Passive, never
 * modal: it teaches the three keys QUICKSTART.md teaches (new task / help /
 * command menu), resolved from the LIVE keymap so a rebound chord shows its
 * real cap and an unbound one drops, and it is honest about the environment
 * (engine CLIs detected via the same probe the new-task dialog uses, git on
 * PATH) with `rove doctor` as the escalation. Creating a task makes it
 * disappear for good — no persisted "dismissed" flag needed.
 */

import { TextAttributes } from "@opentui/core"
import type { ReactNode } from "react"
import { useEffect, useState } from "react"
import { installedEngineIds } from "../../engine/account-detect.ts"
import { formatChord } from "../../tui/lib/chord-glyphs"
import { legendCap } from "../../tui/lib/help-groups"
import { currentPrefixConfiguration } from "../../tui/lib/keymap-dispatch"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"

export type WelcomeEnv = {
  readonly engines: readonly string[]
  readonly git: boolean
}

/** Real probe: engine binaries (memoized in account-detect) + git on PATH. */
async function probeWelcomeEnv(): Promise<WelcomeEnv> {
  const engines = await installedEngineIds().catch(() => [] as const)
  // ponytail: Bun.which is absent under vitest's node runtime; there we
  // assume git exists rather than shell out — a false "missing" warning on a
  // dev box is worse than skipping the check outside production.
  const git = globalThis.Bun?.which ? globalThis.Bun.which("git") !== null : true
  return { engines, git }
}

type StepLine = { cap: string; msg: "stepNew" | "stepHelp" | "stepPrefix" }

/** The three teachable keys, resolved live; unbound rows drop. */
function stepLines(): StepLine[] {
  const lines: StepLine[] = []
  const newTask = legendCap("task.new")
  if (newTask) lines.push({ cap: formatChord(newTask), msg: "stepNew" })
  const help = legendCap("help.open")
  if (help) lines.push({ cap: formatChord(help), msg: "stepHelp" })
  const prefix = currentPrefixConfiguration().key
  if (prefix !== null) lines.push({ cap: formatChord(prefix), msg: "stepPrefix" })
  return lines
}

export function WelcomePane(props: { probe?: () => Promise<WelcomeEnv> }): ReactNode {
  const { theme } = useTheme()
  const t = useT()
  const [env, setEnv] = useState<WelcomeEnv | null>(null)
  const probe = props.probe ?? probeWelcomeEnv

  // biome-ignore lint/correctness/useExhaustiveDependencies: probe once on mount.
  useEffect(() => {
    let alive = true
    void probe().then((result) => {
      if (alive) setEnv(result)
    })
    return () => {
      alive = false
    }
  }, [])

  const steps = stepLines()
  const capWidth = Math.max(...steps.map((s) => s.cap.length), 0)
  const broken = env !== null && (env.engines.length === 0 || !env.git)

  return (
    <box flexGrow={1} alignItems="center" justifyContent="center">
      {/* maxWidth caps line length for readability on wide terminals; the
          block still shrinks with the pane (flex handles narrow). */}
      <box flexDirection="column" maxWidth={72} paddingLeft={2} paddingRight={2}>
        <text fg={theme.primary} attributes={TextAttributes.BOLD} wrapMode="none">
          {t("workspace.welcome.title")}
        </text>
        <text fg={theme.textMuted} wrapMode="word">
          {t("workspace.welcome.tagline")}
        </text>
        <box flexDirection="column" paddingTop={1}>
          {steps.map((step) => (
            <box key={step.msg} flexDirection="row" gap={2}>
              <text fg={theme.primary} wrapMode="none">
                {step.cap.padEnd(capWidth)}
              </text>
              <text fg={theme.textMuted} wrapMode="word">
                {t(`workspace.welcome.${step.msg}`)}
              </text>
            </box>
          ))}
        </box>
        <box paddingTop={1}>
          <text fg={theme.textMuted} wrapMode="word">
            {t("workspace.welcome.worktreeExplain")}
          </text>
        </box>
        {env !== null ? (
          <box flexDirection="column" paddingTop={1}>
            {env.engines.length > 0 ? (
              <text fg={theme.textMuted} wrapMode="word">
                {t("workspace.welcome.enginesFound", { list: env.engines.join(" · ") })}
              </text>
            ) : (
              <text fg={theme.warning} wrapMode="word">
                {t("workspace.welcome.enginesMissing")}
              </text>
            )}
            {env.git ? null : (
              <text fg={theme.warning} wrapMode="word">
                {t("workspace.welcome.gitMissing")}
              </text>
            )}
            {broken ? (
              <text fg={theme.textMuted} wrapMode="word">
                {t("workspace.welcome.doctorHint")}
              </text>
            ) : null}
          </box>
        ) : null}
        <box paddingTop={1}>
          <text fg={theme.textMuted} attributes={TextAttributes.DIM} wrapMode="none">
            {t("workspace.welcome.docsHint")}
          </text>
        </box>
      </box>
    </box>
  )
}
