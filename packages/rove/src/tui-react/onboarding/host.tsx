/** @jsxImportSource @opentui/react */
/**
 * The first-run welcome — a modal over the real workspace, shown once, so
 * dismissing it leaves the user in the product rather than at a shell prompt.
 *
 * Engine readiness comes first; optional installs follow.
 *
 * The skill installs the moment it is accepted, and the result shows in the
 * dialog. Completions are queued until the TUI exits and releases the
 * terminal (`cli/welcome.ts`).
 */

import { TextAttributes } from "@opentui/core"
import type { ReactNode } from "react"
import { useEffect, useRef, useState } from "react"
import type { ShellKind } from "../../cli/completion-scripts.ts"
import { trackWelcomeWrite } from "../../cli/launch-tui.ts"
import type { WelcomeRequest } from "../../cli/welcome.ts"
import { installSkillErrors, skillTargets } from "../../lib/skill-install.ts"
import { wizardKeyLines } from "../../tui/lib/keyboard-hints"
import { currentPrefixConfiguration } from "../../tui/lib/keymap-dispatch"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { useBindings } from "../lib/keymap"
import { type DialogContext, useDialog } from "../ui/dialog"
import { type WelcomeEnv, probeWelcomeEnv } from "../workspace/welcome-pane"
import { EngineWelcomePage } from "./engine-page"

/** Confirmed choices survive dismissal; unanswered questions default to No. */
export interface OnboardingChoices {
  readonly completions: boolean
}

type StepId = "completions" | "skill"
type WelcomePageKind = "engine" | "questions" | "keys"

/** Horizontal padding, matching the What's New card. */
const PAD_X = 2

/** Exported for the render track; production opens it via {@link useWelcomeDialog}. */
export function WelcomeDialogView(props: {
  shell: ShellKind | null
  probe?: () => Promise<WelcomeEnv>
  onDone: (choices: OnboardingChoices) => void
  onAnswers?: (choices: OnboardingChoices) => void
  /** Installs the skill and returns the line to show; injected by the render track. */
  installSkill?: () => string
}): ReactNode {
  const { theme } = useTheme()
  const t = useT()
  const [skillLine, setSkillLine] = useState<string | null>(null)
  // No shell detected → no completions question.
  const steps: readonly StepId[] = props.shell === null ? ["skill"] : ["completions", "skill"]
  const [stepIndex, setStepIndex] = useState(0)
  // Both questions default to Yes; the skill is what lets agents drive Rove.
  const [yes, setYes] = useState(true)
  const [answers, setAnswers] = useState<Partial<Record<StepId, boolean>>>({})
  const [page, setPage] = useState<WelcomePageKind>("engine")
  const [env, setEnv] = useState<WelcomeEnv | null>(null)
  const probe = props.probe ?? probeWelcomeEnv
  useEffect(() => {
    let alive = true
    void probe().then((value) => {
      if (alive) setEnv(value)
    })
    return () => {
      alive = false
    }
  }, [probe])

  const step = steps[stepIndex] as StepId
  const answeredSteps = steps.slice(0, page === "questions" ? stepIndex : steps.length)

  function finish(finalAnswers: Partial<Record<StepId, boolean>>): void {
    props.onDone({ completions: finalAnswers.completions ?? false })
  }

  // `choice` defaults to the keyboard cursor; mouse passes its own option
  // explicitly (setYes + read-back in one handler would see a stale render).
  function confirm(choice: boolean = yes): void {
    if (page === "engine") {
      if (env !== null) setPage("questions")
      return
    }
    if (page === "keys") {
      finish(answers)
      return
    }
    const next = { ...answers, [step]: choice }
    setAnswers(next)
    if (step === "skill" && choice) setSkillLine((props.installSkill ?? (() => installSkillLine(t)))())
    props.onAnswers?.({ completions: next.completions ?? false })
    if (stepIndex + 1 >= steps.length) {
      setPage("keys")
      return
    }
    setStepIndex(stepIndex + 1)
    setYes(true)
  }

  useBindings(() => ({
    bindings: [
      { key: "up", cmd: () => setYes(true) },
      { key: "k", cmd: () => setYes(true) },
      { key: "down", cmd: () => setYes(false) },
      { key: "j", cmd: () => setYes(false) },
      { key: "return", cmd: () => confirm() },
    ],
  }))

  function labelFor(s: StepId): string {
    return s === "completions"
      ? t("onboarding.completionsLabel", { shell: props.shell ?? "" })
      : t("onboarding.skillLabel")
  }
  const explain = step === "completions" ? t("onboarding.completionsExplain") : t("onboarding.skillExplain")

  // Transcript flow: answered questions stay as one muted line each, the
  // active one below them.
  return (
    <box paddingLeft={PAD_X} paddingRight={PAD_X} gap={1} flexShrink={1}>
      <box flexDirection="column" gap={0} flexShrink={0}>
        <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none">
          {t("onboarding.title")}
        </text>
        <text fg={theme.textMuted} wrapMode="word">
          {t("onboarding.subtitle")}
        </text>
      </box>
      <box flexDirection="column" flexShrink={1}>
        {page !== "engine" && answeredSteps.length > 0 ? (
          // One quiet line per answered step, a blank line before the active one.
          <box flexDirection="column" paddingBottom={1}>
            {answeredSteps.map((answered) => (
              <box key={answered} flexDirection="row" gap={1}>
                <text fg={answers[answered] ? theme.success : theme.textMuted} wrapMode="none">
                  {answers[answered] ? "✓" : "–"}
                </text>
                <text fg={theme.text} wrapMode="none">
                  {labelFor(answered)}
                </text>
                <text fg={theme.textMuted} wrapMode="none">
                  {`· ${!answers[answered] ? t("onboarding.skipped") : answered === "skill" ? skillLine : t("onboarding.queued")}`}
                </text>
              </box>
            ))}
          </box>
        ) : null}
        {page === "engine" ? (
          <EngineWelcomePage env={env} onContinue={() => confirm()} />
        ) : page === "keys" ? (
          <box flexDirection="column" onMouseUp={() => confirm()}>
            <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="word">
              {t("onboarding.keysTitle")}
            </text>
            {wizardKeyLines(currentPrefixConfiguration().key).map((line) => (
              <text key={line.msg} fg={theme.textMuted} wrapMode="word">
                {t(`onboarding.${line.msg}`, line.params)}
              </text>
            ))}
            {/* The dialog's exit door. Every engine's activity hooks are
                installed on launch, but nothing told the user WHERE that
                lives — so a machine whose engine arrived later had no way
                back to it short of reading the docs. */}
            <text fg={theme.textMuted} wrapMode="word">
              {t("onboarding.keysNext")}
            </text>
          </box>
        ) : (
          <>
            <box flexDirection="row">
              <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none" flexGrow={1}>
                {labelFor(step)}
              </text>
              <text fg={theme.textMuted} wrapMode="none">
                {t("onboarding.stepCounter", { n: String(stepIndex + 1), total: String(steps.length) })}
              </text>
            </box>
            <box paddingBottom={1}>
              <text fg={theme.textMuted} wrapMode="word">
                {explain}
              </text>
            </box>
            {/* Options as list rows: the selected one is a filled row, as in Settings. */}
            {[true, false].map((option) => {
              const active = yes === option
              return (
                <box
                  key={String(option)}
                  flexDirection="row"
                  gap={2}
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={active ? theme.primary : undefined}
                  onMouseUp={() => confirm(option)}
                >
                  <text fg={active ? theme.selectedListItemText : theme.text} wrapMode="none">
                    {option ? t("onboarding.optionYes") : t("onboarding.optionNo")}
                  </text>
                  {option && step === "skill" ? (
                    <text fg={active ? theme.selectedListItemText : theme.textMuted} wrapMode="none">
                      {t("onboarding.recommended")}
                    </text>
                  ) : null}
                </box>
              )
            })}
          </>
        )}
      </box>
      <box paddingBottom={1} flexShrink={0}>
        <text fg={theme.textMuted} attributes={TextAttributes.DIM} wrapMode="none">
          {t(
            page === "engine"
              ? "onboarding.engineLegend"
              : page === "keys"
                ? "onboarding.keysLegend"
                : "onboarding.legend",
          )}
        </text>
      </box>
    </box>
  )
}

/** Copy the skill into every engine set up here; the line says where, or why not. */
function installSkillLine(t: ReturnType<typeof useT>): string {
  const engines = skillTargets().map((target) => target.displayName)
  if (engines.length === 0) return t("onboarding.skillNoEngines")
  const error = installSkillErrors()
  return error
    ? t("onboarding.skillFailed", { reason: error })
    : t("onboarding.skillInstalled", { engines: engines.join(", ") })
}

/** `replace`, not `push`: it arrives on boot with nothing underneath to return to. */
function show(dialog: DialogContext, opts: { shell: ShellKind | null; onDone: (c: OnboardingChoices) => void }): void {
  // `dialog.clear()` runs this entry's onClose, so without the guard an
  // accepted answer is followed by a "declined everything" one that wins.
  let settled = false
  let confirmed: OnboardingChoices = { completions: false }
  const once = (choices: OnboardingChoices): void => {
    if (settled) return
    settled = true
    opts.onDone(choices)
  }
  dialog.replace(
    () => (
      <WelcomeDialogView
        shell={opts.shell}
        onAnswers={(choices) => {
          confirmed = choices
        }}
        onDone={(choices) => {
          once(choices)
          dialog.clear()
        }}
      />
    ),
    // Closing only skips questions the user has not answered.
    () => once(confirmed),
  )
  dialog.setSize("medium")
}

export const WelcomeDialog = { show }

/**
 * Hand the boot-time first-run signal to the dialog stack, once. The CLI
 * recorder is a dynamic import so a render-track mount can't pull a
 * state-writing module into its graph.
 */
export function useWelcomeDialog(request: WelcomeRequest | null, onClosed: () => void): void {
  const dialog = useDialog()
  const opened = useRef(false)
  const shell = request?.shell ?? null
  useEffect(() => {
    if (request === null || opened.current) return
    opened.current = true
    WelcomeDialog.show(dialog, {
      shell,
      onDone: (choices) => {
        onClosed()
        trackWelcomeWrite(import("../../cli/onboarding.ts").then((m) => m.recordWelcomeChoices(choices, shell)))
      },
    })
  }, [request, dialog, onClosed, shell])
}
