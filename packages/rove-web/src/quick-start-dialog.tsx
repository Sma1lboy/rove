/**
 * The TUI's prompt-first quick-task composer (`quick-task-composer.tsx`), opened from the welcome
 * pane: prompt, attempts, engine, branch, attachments. Enter creates; Tab walks prompt → attempts →
 * engine → branch; Ctrl+E steps the engine; Ctrl+X drops the last attachment.
 */

import { useState } from "react"
import { AttachmentChips, useAttachments, withRefs } from "./attachments.tsx"
import { ChipRow } from "./chip-row.tsx"
import { DialogActions, DialogShell, useSubmit } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import { isTouch } from "./key-hints.ts"
import type { AppModel } from "./model.ts"
import { cycleStop } from "./tab-stops.ts"
import { tc } from "./tui-copy.ts"
import { toast } from "./ui.ts"
import { FIELD, TEXTAREA } from "./ui/form.ts"
import { DIALOG_BODY } from "./ui/overlay.ts"
import { HINT, INPUT, KICKER } from "./ui/text.ts"
import { prefixHint } from "./user-keys.ts"

/** The attempts a prompt can fan out to; the TUI stops at 5 (`ORCHESTRATION.md`: 3-4 is the sweet spot). */
export const ATTEMPTS = ["1", "2", "3", "4", "5"] as const

const STOPS = ["message", "attempts", "engine", "base"] as const

export interface QuickStart {
  readonly repo: string
  readonly label: string
  readonly baseRef: string
  readonly engine: string
}

export interface EngineChip {
  readonly id: string
  readonly name: string
}

export function QuickStartDialog(props: { model: AppModel; start: QuickStart; engines: readonly EngineChip[] }) {
  const { model, start, engines } = props
  const [prompt, setPrompt] = useState("")
  const [attempts, setAttempts] = useState("1")
  const [engine, setEngine] = useState(start.engine)
  const [baseRef, setBaseRef] = useState(start.baseRef)
  const { busy, error, setError, submit } = useSubmit()
  const { attachments, attach, remove } = useAttachments(model, setError)

  const stepEngine = () => {
    const at = engines.findIndex((e) => e.id === engine)
    const next = engines[(at + 1) % engines.length]
    if (next) setEngine(next.id)
  }

  const create = () =>
    submit(async () => {
      if (prompt.trim().length === 0) {
        document.querySelector<HTMLElement>("[data-field=message]")?.focus()
        throw new Error(tc("quickTask", "promptPlaceholder"))
      }
      const count = Number(attempts)
      const res = await model.client.request<{ taskIds: string[] }>("task.spawn", {
        repo: start.repo,
        engine,
        baseBranch: baseRef.trim() || start.baseRef,
        prompt: withRefs(prompt.trim(), attachments),
        ...(count > 1 ? { count } : {}),
      })
      if (count > 1) toast(tc("quickTask", "startedRound", { count: res.taskIds.length }))
      const first = res.taskIds[0]
      if (first) model.selectWhenListed(first)
    })

  return (
    <DialogShell title={tc("quickTask", "title", { repoLabel: start.label })} wide>
      <form
        className={DIALOG_BODY}
        onKeyDown={(e) => {
          if (e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault()
            cycleStop(e.currentTarget, STOPS, e.shiftKey ? -1 : 1)
          } else if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "e") {
            e.preventDefault()
            e.stopPropagation()
            stepEngine()
          } else if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "x") {
            e.preventDefault()
            const last = attachments.at(-1)
            if (last) remove(last.path)
          } else if (
            e.key === "Enter" &&
            !e.shiftKey &&
            (e.target as HTMLElement).closest("[data-field=attempts], [data-field=engine]")
          ) {
            e.preventDefault()
            e.currentTarget.requestSubmit()
          }
        }}
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          void attach(Array.from(e.dataTransfer.files))
        }}
      >
        <p className="text-muted">
          {isTouch()
            ? t("pages.quickIntentTouch")
            : tc("onboarding", "quickIntent", { key: prefixHint("task.new.global") })}
        </p>
        <label className={FIELD}>
          <span className={`${KICKER} text-muted`}>{tc("quickTask", "promptLabel")}</span>
          <textarea
            className={`${INPUT} text-ink ${TEXTAREA}`}
            data-field="message"
            // biome-ignore lint/a11y/noAutofocus: the dialog's main field
            autoFocus
            rows={3}
            placeholder={tc("quickTask", "promptPlaceholder")}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files)
              if (files.length === 0) return
              e.preventDefault()
              void attach(files)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }
            }}
          />
        </label>
        <div className={FIELD}>
          <span className={`${KICKER} text-muted`}>{tc("quickTask", "attemptsLabel")}</span>
          <ChipRow
            label={tc("quickTask", "attemptsLabel")}
            field="attempts"
            value={attempts}
            onChange={setAttempts}
            choices={ATTEMPTS.map((n) => ({ id: n, label: n }))}
          />
        </div>
        <div className={FIELD}>
          <span className={`${KICKER} text-muted`}>{tc("quickTask", "engineLabel")}</span>
          <ChipRow
            label={tc("quickTask", "engineLabel")}
            field="engine"
            value={engine}
            onChange={setEngine}
            choices={engines.map((e) => ({ id: e.id, label: e.name }))}
          />
        </div>
        <label className={FIELD}>
          <span className={`${KICKER} text-muted`}>{tc("quickTask", "branchLabel")}</span>
          <input
            className={`${INPUT} text-ink`}
            data-field="base"
            spellCheck={false}
            value={baseRef}
            onChange={(e) => setBaseRef(e.target.value)}
          />
        </label>
        <AttachmentChips attachments={attachments} onRemove={remove} />
        {isTouch() ? (
          <p className="text-muted">{t("pages.attachHintTouch")}</p>
        ) : (
          <p className={`keys-only mx-0 mt-2 mb-0 ${HINT}`}>{tc("quickTask", "legend")}</p>
        )}
        {error && <p className="text-error">{error}</p>}
        <DialogActions busy={busy} submitLabel={t("newChat.start")} />
      </form>
    </DialogShell>
  )
}
