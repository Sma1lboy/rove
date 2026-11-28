/** @jsxImportSource @opentui/react */
/**
 * Center-column empty state when NO task exists. Passive, never modal: teaches
 * the three QUICKSTART.md keys (new task / help / command menu) from the LIVE
 * keymap (rebound shows its cap, unbound drops), and reports the environment
 * (engines via the new-task dialog's probe, git on PATH) with `rove doctor` as
 * the escalation. The first task makes it disappear; no dismissed flag.
 */

import { TextAttributes } from "@opentui/core"
import { formatChord } from "@sma1lboy/rove-client/keys/chord-glyphs.ts"
import { legendCap } from "@sma1lboy/rove-client/keys/help-groups.ts"
import { findBinding } from "@sma1lboy/rove-client/keys/keybindings.ts"
import { currentPrefixConfiguration } from "@sma1lboy/rove-client/keys/keymap-dispatch.ts"
import { displayWidth, padEndCells } from "@sma1lboy/rove-core/lib/display-width.ts"
import type { VendorId } from "@sma1lboy/rove-core/types/vendor.ts"
import type { ReactNode } from "react"
import { useEffect, useState } from "react"
import { humanOnlyFix, noEngineFix } from "../../cli/doctor-fix"
import { detectEngineStatuses, probeableEngineIds, summarizeEngines } from "../../engine/engine-status.ts"
import { engineDisplayName } from "../../engine/interactive-command"
import { DoctorSuggestions } from "../component/doctor-suggestions"
import type { QuickTaskResult } from "../component/quick-task-composer"
import { useOptionalFocus } from "../context/focus"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { FirstTaskStart } from "./first-task-start"

export type WelcomeEnv = {
  /** Engines that can actually run a task: installed AND signed in. */
  readonly engines: readonly VendorId[]
  /** Installed, but the login Rove can read says there is no account. */
  readonly signedOut: readonly VendorId[]
  readonly git: boolean
}

/**
 * Engine binary AND account (same `probeEngines` as `rove doctor`), plus git.
 * Binary-only would show `✓` on the likeliest new-user machine (CLIs installed,
 * none logged in) right after the wizard said `✗ No usable engine yet`.
 */
export async function probeWelcomeEnv(): Promise<WelcomeEnv> {
  const { usable, signedOut } = await probeableEngineIds()
    .then(detectEngineStatuses)
    .then(summarizeEngines)
    .catch(() => ({ usable: [], signedOut: [] }))
  // ponytail: Bun.which is absent under vitest's node runtime; there we
  // assume git exists rather than shell out — a false "missing" warning on a
  // dev box is worse than skipping the check outside production.
  const git = globalThis.Bun?.which ? globalThis.Bun.which("git") !== null : true
  return { engines: usable, signedOut, git }
}

type StepLine = { cap: string; msg: "stepNew" | "stepHelp" | "stepPrefix" }

/**
 * `task.new` is sidebar-scoped: off the sidebar, teach the prefix chord that
 * actually fires there. Unbound rows drop.
 */
function newTaskCap(sidebarFocused: boolean, prefix: string | null): string | null {
  if (sidebarFocused) {
    const cap = legendCap("task.new")
    return cap ? formatChord(cap) : null
  }
  const stroke = findBinding("task.new.global")?.prefixKeys?.[0]
  return prefix !== null && stroke ? `${formatChord(prefix)} ${formatChord(stroke)}` : null
}

/** The three teachable keys, resolved live; unbound rows drop. */
function stepLines(sidebarFocused: boolean): StepLine[] {
  const lines: StepLine[] = []
  const prefix = currentPrefixConfiguration().key
  const newTask = newTaskCap(sidebarFocused, prefix)
  if (newTask) lines.push({ cap: newTask, msg: "stepNew" })
  const help = legendCap("help.open")
  if (help) lines.push({ cap: formatChord(help), msg: "stepHelp" })
  if (prefix !== null) lines.push({ cap: formatChord(prefix), msg: "stepPrefix" })
  return lines
}

export function WelcomePane(props: {
  probe?: () => Promise<WelcomeEnv>
  onQuickTask?: (repo: string, result: QuickTaskResult) => void
}): ReactNode {
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

  // No provider (bare render tests) reads as the FocusProvider default, sidebar.
  const focused = useOptionalFocus()?.focused ?? "sidebar"
  const steps = stepLines(focused === "sidebar")
  // Cell width, not .length: ⌘/⌃ caps are one UTF-16 unit but wider in cells
  // (CJK caps are 2), so .length misaligns every row.
  const capWidth = Math.max(...steps.map((s) => displayWidth(s.cap)), 0)
  const broken = env !== null && (env.engines.length === 0 || !env.git)
  // Three states: "installed but not signed in" is the common cold state.
  const engineLine =
    env === null
      ? null
      : env.engines.length > 0
        ? { key: "enginesFound" as const, fg: theme.textMuted, list: env.engines.map(engineDisplayName).join(" · ") }
        : env.signedOut.length > 0
          ? {
              key: "enginesSignedOut" as const,
              fg: theme.warning,
              list: env.signedOut.map(engineDisplayName).join(" · "),
            }
          : { key: "enginesMissing" as const, fg: theme.warning, list: "" }

  return (
    <scrollbox flexGrow={1} contentOptions={{ alignItems: "center" }}>
      {/* maxWidth caps line length for readability on wide terminals; the
          block still shrinks with the pane (flex handles narrow). */}
      <box flexDirection="column" flexShrink={0} maxWidth={72} paddingLeft={2} paddingRight={2}>
        <text fg={theme.primary} attributes={TextAttributes.BOLD} wrapMode="none">
          {t("workspace.welcome.title")}
        </text>
        <text fg={theme.textMuted} wrapMode="word">
          {t("workspace.welcome.tagline")}
        </text>
        <box flexDirection="column" paddingTop={1}>
          {/* width: a content-sized row measures its wrapped text as one line
              and squeezes the rows below it out of the column. */}
          {steps.map((step) => (
            <box key={step.msg} flexDirection="row" width="100%" gap={2}>
              <text fg={theme.primary} wrapMode="none">
                {padEndCells(step.cap, capWidth)}
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
        {env !== null && engineLine !== null ? (
          <box flexDirection="column" paddingTop={1}>
            <text fg={engineLine.fg} wrapMode="word">
              {t(`workspace.welcome.${engineLine.key}`, { list: engineLine.list })}
            </text>
            {env.git ? null : (
              <text fg={theme.warning} wrapMode="word">
                {t("workspace.welcome.gitMissing")}
              </text>
            )}
            {broken ? (
              <DoctorSuggestions
                fixes={[
                  ...(!env.git ? [humanOnlyFix("git")] : []),
                  ...(env.engines.length === 0 ? [noEngineFix(env.signedOut)] : []),
                ]}
              />
            ) : null}
          </box>
        ) : null}
        {env && props.onQuickTask ? (
          <FirstTaskStart
            env={env}
            newTaskKey={steps.find((s) => s.msg === "stepNew")?.cap ?? "n"}
            onCreate={props.onQuickTask}
          />
        ) : null}
        <box paddingTop={1}>
          <text fg={theme.textMuted} attributes={TextAttributes.DIM} wrapMode="none">
            {t("workspace.welcome.docsHint")}
          </text>
        </box>
      </box>
    </scrollbox>
  )
}
