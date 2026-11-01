/**
 * The TUI's modal grammar on the web: one centred card, Esc or a click
 * outside cancels, Enter submits. Every submit is a bridge call; a refusal
 * stays in the dialog as its message instead of closing it.
 */

import { type ReactNode, useEffect, useRef, useState } from "react"
import { t, useLocale } from "./i18n/index.ts"
import { closeDialog } from "./ui.ts"
import { buttonClass } from "./ui/button.tsx"
import { CHOICES } from "./ui/form.ts"
import { DIALOG_BODY, DIALOG_CLOSE, DIALOG_HEAD, DIALOG_TITLE, OVERLAY, dialogClass } from "./ui/overlay.ts"
import { GLYPH, ROW_TITLE, rowClass } from "./ui/row.ts"
import { ACTIONS, INPUT, LINK } from "./ui/text.ts"

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function DialogShell(props: { title: string; children: ReactNode; wide?: boolean }) {
  useLocale()
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    // Opened from the terminal, focus would stay in xterm, which stops keys (Esc too) at itself.
    if (ref.current && !ref.current.contains(document.activeElement)) ref.current.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        closeDialog()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  return (
    <div className={OVERLAY} onMouseDown={(e) => e.target === e.currentTarget && closeDialog()}>
      <dialog ref={ref} tabIndex={-1} open className={dialogClass(props.wide)} aria-label={props.title}>
        <div className={DIALOG_HEAD}>
          <h1 className={DIALOG_TITLE}>{props.title}</h1>
          <button
            type="button"
            className={DIALOG_CLOSE}
            aria-label={t("dialog.close")}
            title={t("dialog.close")}
            onClick={closeDialog}
          >
            ×
          </button>
        </div>
        {props.children}
      </dialog>
    </div>
  )
}

/** Runs `action`; closes on success, shows the refusal on failure. */
function useSubmit() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      closeDialog()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, setError, submit }
}

export function TextDialog(props: {
  title: string
  initial?: string
  submitLabel: string
  /** A blank value is a valid answer (a rename that clears back to the default name). */
  allowEmpty?: boolean
  onSubmit: (value: string) => Promise<void>
}) {
  const [value, setValue] = useState(props.initial ?? "")
  const { busy, error, submit } = useSubmit()
  return (
    <DialogShell title={props.title}>
      <form
        className={DIALOG_BODY}
        onSubmit={(e) => {
          e.preventDefault()
          if (value.trim() || props.allowEmpty) void submit(() => props.onSubmit(value.trim()))
        }}
      >
        <input
          className={`${INPUT} text-ink`}
          aria-label={props.title}
          // biome-ignore lint/a11y/noAutofocus: a dialog's only field
          autoFocus
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
        />
        {error && <p className="text-error">{error}</p>}
        <DialogActions busy={busy} submitLabel={props.submitLabel} />
      </form>
    </DialogShell>
  )
}

export function ConfirmDialog(props: {
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => Promise<void>
  /** A second way to confirm, shown beside the first (delete with its children); a refusal escalates with `run(true)`. */
  secondary?: { readonly label: string; readonly onConfirm: () => Promise<void> }
  /** A refusal that can be retried harder (dirty worktree → force). `title`/`body` replace the dialog's own once it fires. */
  escalate?: {
    readonly when: (err: unknown) => boolean
    readonly label: string
    /** `secondary`: the refused attempt was the secondary action's, so the harder retry keeps it. */
    readonly run: (secondary: boolean) => Promise<void>
    readonly title?: string
    readonly body?: (err: unknown) => string
  }
}) {
  const { busy, error, setError, submit } = useSubmit()
  const [escalated, setEscalated] = useState(false)
  const [refusal, setRefusal] = useState<unknown>(null)
  const [viaSecondary, setViaSecondary] = useState(false)
  const confirm = useRef<HTMLButtonElement>(null)
  useEffect(() => confirm.current?.focus(), [])
  const go = (secondary: boolean) =>
    void submit(async () => {
      try {
        if (escalated && props.escalate) await props.escalate.run(viaSecondary)
        else await (secondary && props.secondary ? props.secondary.onConfirm() : props.onConfirm())
      } catch (err) {
        if (!escalated && props.escalate?.when(err)) {
          setEscalated(true)
          setRefusal(err)
          setViaSecondary(secondary)
          setError(errorText(err))
        }
        throw err
      }
    })
  return (
    <DialogShell title={(escalated && props.escalate?.title) || props.title}>
      <div className={DIALOG_BODY}>
        <p className="whitespace-pre-line text-muted">
          {escalated && props.escalate?.body ? props.escalate.body(refusal) : props.body}
        </p>
        {error && !(escalated && props.escalate?.body) && <p className="text-error">{error}</p>}
        <div className={ACTIONS}>
          <button type="button" className={`${LINK} text-accent`} onClick={closeDialog}>
            {t("dialog.cancel")}
          </button>
          {props.secondary && !escalated && (
            <button type="button" className={buttonClass({ danger: true })} disabled={busy} onClick={() => go(true)}>
              {props.secondary.label}
            </button>
          )}
          <button
            ref={confirm}
            type="button"
            className={buttonClass({ danger: true })}
            disabled={busy}
            onClick={() => go(false)}
          >
            {escalated && props.escalate ? props.escalate.label : props.confirmLabel}
          </button>
        </div>
      </div>
    </DialogShell>
  )
}

export interface Choice {
  readonly value: string
  readonly label: string
}

/** A short list: ↑/↓ moves, Enter or click picks; the current value is marked. */
export function ChoiceDialog(props: {
  title: string
  choices: readonly Choice[]
  current?: string
  onPick: (value: string) => Promise<void>
}) {
  const start = Math.max(
    0,
    props.choices.findIndex((c) => c.value === props.current),
  )
  const [index, setIndex] = useState(start)
  const { busy, error, submit } = useSubmit()
  const pick = (value: string) => void submit(() => props.onPick(value))
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "j") setIndex((i) => Math.min(props.choices.length - 1, i + 1))
      else if (e.key === "ArrowUp" || e.key === "k") setIndex((i) => Math.max(0, i - 1))
      else if (e.key === "Enter") {
        const choice = props.choices[index]
        if (choice) pick(choice.value)
      } else return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })
  return (
    <DialogShell title={props.title}>
      <div className={DIALOG_BODY}>
        <ul className={CHOICES}>
          {props.choices.map((choice, i) => (
            <li key={choice.value}>
              <button
                type="button"
                aria-pressed={choice.value === props.current}
                disabled={busy}
                className={rowClass({ selected: i === index })}
                onMouseEnter={() => setIndex(i)}
                onClick={() => pick(choice.value)}
              >
                <span className={`${GLYPH} text-accent`}>{choice.value === props.current ? "●" : " "}</span>
                <span className={ROW_TITLE}>{choice.label}</span>
              </button>
            </li>
          ))}
        </ul>
        {error && <p className="text-error">{error}</p>}
      </div>
    </DialogShell>
  )
}

export function DialogActions({ busy, submitLabel }: { busy: boolean; submitLabel: string }) {
  return (
    <div className={ACTIONS}>
      <button type="button" className={`${LINK} text-accent`} onClick={closeDialog}>
        {t("dialog.cancel")}
      </button>
      <button type="submit" className={buttonClass()} disabled={busy}>
        {submitLabel}
      </button>
    </div>
  )
}

export { errorText, useSubmit }
