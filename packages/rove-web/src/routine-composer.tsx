/**
 * The new-routine card (TUI `automation-composer-dialog.tsx`): name, project, where it delivers,
 * prompt and a five-cell schedule with a live "when does it fire" line. Tab walks the fields,
 * ↑/↓ drive the project and delivery lists, ←/→ (or h/l) pick a schedule cell and ↑/↓ change it,
 * Enter creates from the Create button, Esc cancels. Fields, validation and the schedule ladder
 * are the TUI's own (`automation-composer-core.ts`, `cron-core.ts`).
 */

import {
  type ComposerDraft,
  EMPTY_DRAFT,
  canSubmitDraft,
  firstIncompleteField,
} from "@sma1lboy/rove/src/tui/component/automation-composer-core.ts"
import {
  CRON_SEGMENTS,
  describeCronWith,
  moveSegmentCursor,
  previewScheduleWith,
  setSegment,
  splitCron,
  stepSegment,
} from "@sma1lboy/rove/src/tui/component/cron-core.ts"
import { type KeyboardEvent, useEffect, useRef, useState } from "react"
import { t, useLocale } from "./i18n/index.ts"
import { deviceHint } from "./key-hints.ts"
import { Legend } from "./legend.tsx"
import { fill, projectLabel, repoKey, useCopy } from "./pages-kit.ts"
import { SelectorField } from "./selector-field.tsx"
import { closeDialog } from "./ui.ts"

export interface TargetTask {
  readonly id: string
  readonly title: string
  readonly repo: string
}

/** The TUI's `t("automations.x")` over the web copy: `cron-core` asks for keys by their TUI path. */
function useCronTranslate() {
  const { auto } = useCopy()
  return (key: string, params?: Record<string, string | number>): string => {
    let node: unknown = auto
    for (const part of key.replace(/^automations\./, "").split(".")) {
      node = node && typeof node === "object" ? Reflect.get(node, part) : undefined
    }
    return typeof node === "string" ? (params ? fill(node, params) : node) : key
  }
}

export function RoutineComposer(props: {
  repos: readonly string[]
  tasks: readonly TargetTask[]
  defaultRepo?: string
  onSubmit: (draft: ComposerDraft) => void
}) {
  const { auto, common } = useCopy()
  const tr = useCronTranslate()
  const intl = useLocale() === "zh" ? "zh-CN" : "en-US"
  const [draft, setDraft] = useState<ComposerDraft>(() => ({
    ...EMPTY_DRAFT,
    repo:
      props.repos.find((repo) => props.defaultRepo && repoKey(repo) === repoKey(props.defaultRepo)) ??
      props.repos[0] ??
      null,
  }))
  const [cell, setCell] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const refs = useRef<Record<string, HTMLElement | null>>({})
  const at = (name: string) => (el: HTMLElement | null) => {
    refs.current[name] = el
  }
  useEffect(() => refs.current.name?.focus(), [])

  const patch = (next: Partial<ComposerDraft>) => {
    setDraft((prev) => ({ ...prev, ...next }))
    setError(null)
  }
  // Capture + stopImmediatePropagation, like the story drawer: the shared dialog Esc is not wanted twice.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.preventDefault()
      e.stopImmediatePropagation()
      closeDialog()
    }
    window.addEventListener("keydown", onKey, { capture: true })
    return () => window.removeEventListener("keydown", onKey, { capture: true })
  }, [])

  const commit = () => {
    if (canSubmitDraft(draft)) {
      closeDialog()
      props.onSubmit({
        name: draft.name.trim(),
        repo: draft.repo === null ? null : draft.repo.trim(),
        prompt: draft.prompt.trim(),
        schedule: draft.schedule.trim(),
        ...(draft.target ? { target: draft.target } : {}),
      })
      return
    }
    // Don't refuse silently: jump to the missing field.
    const gap = firstIncompleteField(draft)
    if (gap) {
      refs.current[gap]?.focus()
      setError(Reflect.get(auto.missing, gap) as string)
    }
  }

  const targets =
    draft.repo === null ? [] : props.tasks.filter((task) => repoKey(task.repo) === repoKey(draft.repo ?? ""))
  const targetIndex = draft.target ? targets.findIndex((task) => task.id === draft.target?.taskId) + 1 : 0
  const pickTarget = (delta: number) => {
    const index = (targetIndex + delta + targets.length + 1) % (targets.length + 1)
    const task = targets[index - 1]
    patch({ target: task ? { kind: "existing-tab", taskId: task.id, tabId: "tab-1" } : undefined })
  }
  const places: readonly (string | null)[] = [null, ...props.repos]
  const pickRepo = (delta: number) => {
    const index = Math.min(Math.max(places.indexOf(draft.repo) + delta, 0), places.length - 1)
    const next = places[index]
    if (next !== undefined) patch({ repo: next, target: undefined })
  }
  const lists = (step: (delta: number) => void) => (e: KeyboardEvent) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return
    e.preventDefault()
    step(e.key === "ArrowDown" ? 1 : -1)
  }
  const nextOnEnter = (next: string) => (e: KeyboardEvent) => {
    if (e.key !== "Enter") return
    e.preventDefault()
    refs.current[next]?.focus()
  }
  const segments = splitCron(draft.schedule)
  const stepCell = (delta: 1 | -1) => {
    const segment = CRON_SEGMENTS[cell]
    if (segment)
      patch({ schedule: setSegment(draft.schedule, cell, stepSegment(segment, segments[cell] ?? "*", delta)) })
  }
  const scheduleKeys = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === "ArrowLeft" || e.key === "h") setCell(moveSegmentCursor(cell, -1))
    else if (e.key === "ArrowRight" || e.key === "l") setCell(moveSegmentCursor(cell, 1))
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") stepCell(e.key === "ArrowUp" ? 1 : -1)
    else return
    e.preventDefault()
  }
  const preview = previewScheduleWith(draft.schedule, Date.now(), tr, intl)
  const described = describeCronWith(draft.schedule, tr)

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && closeDialog()}>
      <dialog open className="dialog is-wide kb-drawer" aria-label={auto.newTitle}>
        <h1 className="kicker">{auto.newTitle}</h1>
        <div className="dialog-body">
          <label className="field">
            <span className="kicker">{auto.fieldName}</span>
            <input
              ref={at("name")}
              className="input"
              spellCheck={false}
              placeholder={auto.namePlaceholder}
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              onKeyDown={nextOnEnter("repo")}
            />
          </label>
          <div className="field">
            <span className="kicker kb-label">
              {auto.fieldRepo}
              <span className="muted kb-hint keys-only">↑/↓</span>
            </span>
            <SelectorField
              fieldRef={at("repo")}
              kind="list"
              label={auto.fieldRepo}
              className="kb-places"
              onKeyDown={lists(pickRepo)}
            >
              {places.map((repo) => (
                <button
                  type="button"
                  key={repo ?? ""}
                  tabIndex={-1}
                  aria-selected={repo === draft.repo}
                  className={`kb-place ${repo === draft.repo ? "is-active" : ""}`}
                  onClick={() => {
                    patch({ repo, target: undefined })
                    refs.current.repo?.focus()
                  }}
                >
                  {repo === draft.repo ? "▸ " : "  "}
                  {repo === null ? t("rail.noProject") : projectLabel(repo, props.repos)}
                </button>
              ))}
            </SelectorField>
          </div>
          <div className="field">
            <span className="kicker kb-label">
              {auto.fieldTarget}
              <span className="muted kb-hint keys-only">↑/↓</span>
            </span>
            <SelectorField
              fieldRef={at("target")}
              kind="list"
              label={auto.fieldTarget}
              onKeyDown={lists(pickTarget)}
              onClick={() => pickTarget(1)}
            >
              {draft.target ? (targets[targetIndex - 1]?.title ?? draft.target.taskId) : auto.targetFresh}
            </SelectorField>
          </div>
          {draft.target && (
            <label className="field">
              <span className="kicker">{auto.fieldTargetTab}</span>
              <input
                ref={at("targetTab")}
                className="input"
                spellCheck={false}
                value={draft.target.tabId}
                onChange={(e) => draft.target && patch({ target: { ...draft.target, tabId: e.target.value } })}
                onKeyDown={nextOnEnter("prompt")}
              />
            </label>
          )}
          <label className="field">
            <span className="kicker">{auto.fieldPrompt}</span>
            <input
              ref={at("prompt")}
              className="input"
              spellCheck={false}
              placeholder={auto.promptPlaceholder}
              value={draft.prompt}
              onChange={(e) => patch({ prompt: e.target.value })}
              onKeyDown={nextOnEnter("schedule")}
            />
          </label>
          <div className="field">
            <span className="kicker kb-label">
              {auto.fieldSchedule}
              <span className="muted kb-hint keys-only">←/→ ↑/↓</span>
            </span>
            <SelectorField
              fieldRef={at("schedule")}
              kind="cells"
              label={auto.fieldSchedule}
              className="pg-cron"
              onKeyDown={scheduleKeys}
            >
              {CRON_SEGMENTS.map((segment, index) => (
                <button
                  type="button"
                  key={segment}
                  tabIndex={-1}
                  className={index === cell ? "is-active" : ""}
                  onClick={() => {
                    setCell(index)
                    refs.current.schedule?.focus()
                  }}
                >
                  {segments[index] ?? "*"}
                  <span>{auto.cronField[segment]}</span>
                </button>
              ))}
            </SelectorField>
            {/* A soft keyboard has no arrows: on touch the picked field steps with these instead. */}
            <div className="pg-cron-step">
              {([-1, 1] as const).map((delta) => {
                const field = auto.cronField[CRON_SEGMENTS[cell] ?? "minute"] ?? ""
                return (
                  <button
                    type="button"
                    key={delta}
                    tabIndex={-1}
                    aria-label={t(delta < 0 ? "pages.cronDown" : "pages.cronUp", { field })}
                    onClick={() => {
                      stepCell(delta)
                      refs.current.schedule?.focus()
                    }}
                  >
                    {delta < 0 ? "−" : "+"}
                  </button>
                )
              })}
            </div>
            {preview.kind === "ok" ? (
              <p className="tone-success mono">
                {described ? `${described}, ` : ""}
                {preview.relative}, {preview.absolute}
              </p>
            ) : (
              <p className="error mono">{preview.kind === "never" ? auto.cronNever : auto.cronInvalid}</p>
            )}
          </div>
          {error && <p className="error">※ {error}</p>}
          <p className="muted kb-legend"><Legend text={deviceHint(auto.composerLegend)} /></p>
          <div className="actions">
            <button type="button" className="link" onClick={closeDialog}>
              {common.cancel}
            </button>
            <button ref={at("confirm")} type="button" className="button" onClick={commit}>
              {common.create}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  )
}
