/** @jsxImportSource @opentui/react */
/**
 * The first-run welcome — a modal over the real workspace, shown once.
 *
 * ## Why a modal and not a pre-TUI wizard
 *
 * This was an inline wizard that ran INSTEAD of the TUI: `rove` rendered a
 * footer, asked its two questions, printed a summary and exited, and the
 * user typed `rove` again to reach the product. A first run therefore ended
 * at the user's own shell prompt, and the environment report it printed was
 * a second copy of what `workspace/welcome-pane.tsx` already renders in the
 * center column from the same `probeEngines`.
 *
 * It is now a dialog, decided the way `whats-new-dialog.tsx` decided its own
 * shape: a page is right for something you NAVIGATE to and come back from;
 * this is a single dismissal you are handed on boot. As a modal, the
 * workspace the user actually came for is visible behind it, and dismissing
 * it leaves them IN the product rather than back in the shell.
 *
 * ## What it asks, and what it no longer says
 *
 *   - QUESTIONS — completions and the agent skill, unchanged. Both remain
 *     re-runnable later (`rove completions --help`, `rove skill install`),
 *     so declining is always safe.
 *   - ENVIRONMENT — dropped. The welcome pane behind this dialog renders the
 *     same engine/git verdict from the same probe; printing it here too made
 *     three copies of one fact, and the copies had already disagreed once
 *     (see the note in `welcome-pane.tsx` about binary-vs-account).
 *   - KEYBOARD BASICS — kept as the second page, and it still ends by naming
 *     Settings → Engines, which is where the one durable action lives.
 *
 * Applying the answers is split by what each one needs: completions is a
 * filesystem write and happens immediately; the skill installer wants a real
 * terminal, so it is recorded and run after the TUI exits (`cli/welcome.ts`).
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

/**
 * Exported for the render track; production opens it through
 * {@link useWelcomeDialog}.
 */
export function WelcomeDialogView(props: {
  shell: ShellKind | null
  onDone: (choices: OnboardingChoices) => void
}): ReactNode {
  const { theme } = useTheme()
  const t = useT()
  // No shell detected → nothing to hook completions into; ask only about
  // the skill. The apply layer skips the completions summary line too.
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

  // Transcript flow inside the card, no backgrounds: answered questions stay
  // on screen as one muted line each (question + chosen answer), the active
  // question flows naturally below them — the npm-create feel, not a form.
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

/**
 * Open it. `dialog.replace` rather than `push`, for the reason What's New
 * gives: this arrives on boot, before anything else could be on the stack,
 * and it is a single dismissal — there is nothing underneath to come back to.
 */
function show(dialog: DialogContext, opts: { shell: ShellKind | null; onDone: (c: OnboardingChoices) => void }): void {
  const settle = (choices: OnboardingChoices): void => {
    opts.onDone(choices)
    dialog.clear()
  }
  dialog.replace(
    () => <WelcomeDialogView shell={opts.shell} onDone={settle} />,
    // Fires for every route out — esc, ctrl+c, a click on the backdrop — so
    // a dismissed dialog settles as "declined everything" exactly once,
    // whichever way the user took. `dialog.clear()` above re-enters here;
    // `onDone` is idempotent at the host (its one-shot state is already null).
    () => opts.onDone({ completions: false, skill: false }),
  )
  dialog.setSize("medium")
}

export const WelcomeDialog = { show }

/**
 * Hand the boot-time "this user has never run Rove" signal to the dialog
 * stack, once. Same signature as `useWhatsNewDialog` and mounted beside it:
 * the request plus the host's one-shot clear, nothing else.
 *
 * Recording the answers lives HERE rather than at the call site because it is
 * part of what this dialog does, and the host has no other use for it. The
 * CLI module is reached through a dynamic import so a render-track mount
 * (which never passes a request, so this effect returns early) cannot pull a
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
