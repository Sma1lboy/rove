/** @jsxImportSource @opentui/react */
/**
 * The first-run welcome — a modal over the real workspace, shown once, so
 * dismissing it leaves the user in the product rather than at a shell prompt.
 *
 *   - Questions: completions and the agent skill. Both are re-runnable
 *     (`rove completions --help`, `rove skill install`), so declining is safe.
 *   - No environment report: `workspace/welcome-pane.tsx` behind it renders
 *     the same probe; a copy here could disagree.
 *   - Keyboard basics as the second page, ending at Settings → Engines.
 *
 * Completions is a filesystem write and applies immediately; the skill
 * installer wants a real terminal, so it runs after the TUI exits
 * (`cli/welcome.ts`).
 */

import { TextAttributes } from "@opentui/core"
import type { ReactNode } from "react"
import { useEffect, useRef, useState } from "react"
import type { ShellKind } from "../../cli/completion-scripts.ts"
import type { WelcomeRequest } from "../../cli/welcome.ts"
import { wizardKeyLines } from "../../tui/lib/keyboard-hints"
import { currentPrefixConfiguration } from "../../tui/lib/keymap-dispatch"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { useBindings } from "../lib/keymap"
import { type DialogContext, useDialog } from "../ui/dialog"

/** The wizard's answers; a dismissed dialog (esc/q) declines everything. */
export interface OnboardingChoices {
  readonly completions: boolean
  readonly skill: boolean
}

type StepId = "completions" | "skill"
type WelcomePageKind = "questions" | "keys"

/** Horizontal padding, matching the What's New card. */
const PAD_X = 2

/** Exported for the render track; production opens it via {@link useWelcomeDialog}. */
export function WelcomeDialogView(props: {
  shell: ShellKind | null
  onDone: (choices: OnboardingChoices) => void
}): ReactNode {
  const { theme } = useTheme()
  const t = useT()
  // No shell detected → no completions question.
  const steps: readonly StepId[] = props.shell === null ? ["skill"] : ["completions", "skill"]
  const [stepIndex, setStepIndex] = useState(0)
  const [yes, setYes] = useState(true)
  const [answers, setAnswers] = useState<Partial<Record<StepId, boolean>>>({})
  const [page, setPage] = useState<WelcomePageKind>("questions")

  const step = steps[stepIndex] as StepId

  function finish(finalAnswers: Partial<Record<StepId, boolean>>): void {
    props.onDone({ completions: finalAnswers.completions ?? false, skill: finalAnswers.skill ?? false })
  }

  // `choice` defaults to the keyboard cursor; mouse passes its own option
  // explicitly (setYes + read-back in one handler would see a stale render).
  function confirm(choice: boolean = yes): void {
    if (page === "keys") {
      finish(answers)
      return
    }
    const next = { ...answers, [step]: choice }
    setAnswers(next)
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

  function questionFor(s: StepId): string {
    return s === "completions"
      ? t("onboarding.completionsQuestion", { shell: props.shell ?? "" })
      : t("onboarding.skillQuestion")
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
        <text fg={theme.accent} wrapMode="word">
          {t("onboarding.subtitle")}
        </text>
      </box>
      <box flexDirection="column" flexShrink={1}>
        {steps.slice(0, page === "questions" ? stepIndex : steps.length).map((answered) => (
          <box key={answered} flexDirection="row" gap={1}>
            <text fg={theme.success} wrapMode="none">
              ✓
            </text>
            <text fg={theme.textMuted} wrapMode="none">
              {questionFor(answered)}
            </text>
            <text fg={theme.text} wrapMode="none">
              {answers[answered] ? t("onboarding.optionYes") : t("onboarding.optionNo")}
            </text>
          </box>
        ))}
        {page === "keys" ? (
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
            <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="word">
              {questionFor(step)}
            </text>
            <text fg={theme.textMuted} wrapMode="word">
              {explain}
            </text>
            {[true, false].map((option) => {
              const active = yes === option
              return (
                <box key={String(option)} flexDirection="row" gap={1} paddingLeft={1} onMouseUp={() => confirm(option)}>
                  <text fg={active ? theme.primary : theme.textMuted} wrapMode="none">
                    {active ? "❯" : " "}
                  </text>
                  <text
                    fg={active ? theme.primary : theme.textMuted}
                    attributes={active ? TextAttributes.BOLD : undefined}
                    wrapMode="none"
                  >
                    {option ? t("onboarding.optionYes") : t("onboarding.optionNo")}
                  </text>
                </box>
              )
            })}
          </>
        )}
      </box>
      <box paddingBottom={1} flexShrink={0}>
        <text fg={theme.textMuted} attributes={TextAttributes.DIM} wrapMode="none">
          {t(page === "keys" ? "onboarding.keysLegend" : "onboarding.legend")}
        </text>
      </box>
    </box>
  )
}

/** `replace`, not `push`: it arrives on boot with nothing underneath to return to. */
function show(dialog: DialogContext, opts: { shell: ShellKind | null; onDone: (c: OnboardingChoices) => void }): void {
  // `dialog.clear()` runs this entry's onClose, so without the guard an
  // accepted answer is followed by a "declined everything" one that wins.
  let settled = false
  const once = (choices: OnboardingChoices): void => {
    if (settled) return
    settled = true
    opts.onDone(choices)
  }
  dialog.replace(
    () => (
      <WelcomeDialogView
        shell={opts.shell}
        onDone={(choices) => {
          once(choices)
          dialog.clear()
        }}
      />
    ),
    // Every other route out (esc, ctrl+c, backdrop) is "declined everything".
    () => once({ completions: false, skill: false }),
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
        void import("../../cli/onboarding.ts").then((m) => m.recordWelcomeChoices(choices, shell))
      },
    })
  }, [request, dialog, onClosed, shell])
}
