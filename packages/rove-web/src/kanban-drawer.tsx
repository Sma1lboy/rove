/**
 * The story drawer (TUI `issue-detail-dialog.tsx`). Detail mode edits title, description and
 * status of a story and starts or opens its session; create mode is the board's `n` intake.
 * Tab cycles the fields in the TUI's order, arrows steer the selector fields, Esc saves a
 * detail draft and cancels a new story, Ctrl+Enter commits (start / open), Ctrl+S in create
 * files the story without starting anything. Every way out resolves to an {@link Outcome};
 * the board owns the writes.
 */

import { relativeAge } from "@sma1lboy/rove/src/lib/relative-time.ts"
import { type ClipboardEvent, type DragEvent, type KeyboardEvent, useEffect, useRef, useState } from "react"
import { errorText } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import { MAX_ATTACHMENT_BYTES, attachableFiles, putAttachment, withImagePlaceholders } from "./kanban-attach.ts"
import { PLACEMENTS, type Placement } from "./kanban-start.ts"
import { deviceHint, isTouch } from "./key-hints.ts"
import { Legend } from "./legend.tsx"
import type { AppModel } from "./model.ts"
import { fill, useCopy } from "./pages-kit.ts"
import { SelectorField } from "./selector-field.tsx"
import { closeDialog, toast } from "./ui.ts"

export const ISSUE_STATUSES = ["open", "doing", "hold", "done"] as const
export type IssueStatus = (typeof ISSUE_STATUSES)[number]

export interface Issue {
  readonly id: number
  readonly title: string
  readonly status: IssueStatus
  readonly created: string
  readonly body: string
  readonly taskId?: string
}

export interface EngineOption {
  readonly id: string
  readonly name: string
}

export interface Draft {
  readonly title: string
  readonly body: string
  readonly status: IssueStatus
}

export interface StartChoice {
  readonly engine: string
  readonly placement: Placement
  readonly jump: boolean
}

/** Every way out of the drawer; `null` (a cancelled new story) is passed to `onCancel`. */
export type Outcome =
  | ({ kind: "start" } & StartChoice & Draft)
  | ({ kind: "open"; taskId: string } & Draft)
  | ({ kind: "unlink" } & Draft)
  | ({ kind: "close" } & Draft)
  | { kind: "create"; title: string; body: string; start: StartChoice | null }

type Field = "title" | "description" | "status" | "engine" | "workspace" | "jump" | "open" | "unlink"

interface EventRow {
  readonly kind: string
  readonly at: number
  readonly tail: string
}

function EventsFeed({ model, taskId }: { model: AppModel; taskId: string }) {
  const { kanban } = useCopy()
  const [rows, setRows] = useState<readonly EventRow[] | null>(null)
  useEffect(() => {
    let live = true
    model.client
      .request<{ events: EventRow[] }>("task.events", { taskId })
      .then((res) => live && setRows(res.events))
      .catch(() => live && setRows([]))
    return () => {
      live = false
    }
  }, [model, taskId])
  return (
    <div className="kb-section">
      <h2 className="kicker">{kanban.detail.eventsLabel}</h2>
      {rows === null ? (
        <p className="muted">{kanban.detail.eventsLoading}</p>
      ) : rows.length === 0 ? (
        <p className="muted">{kanban.detail.eventsNone}</p>
      ) : (
        rows.map((row) => (
          <div key={`${row.at}:${row.kind}:${row.tail}`} className="kb-event mono">
            <span className="muted kb-age">{relativeAge(row.at)}</span>
            <span>{row.kind}</span>
            {row.tail && <span className="muted">{row.tail}</span>}
          </div>
        ))
      )}
    </div>
  )
}

export function IssueDrawer(props: {
  model: AppModel
  issue: Issue
  mode: "detail" | "create"
  engines: readonly EngineOption[]
  defaultEngine: string
  onOutcome: (outcome: Outcome) => void
}) {
  const { kanban } = useCopy()
  const { issue, mode } = props
  const create = mode === "create"
  const linkedTaskId = !create && issue.taskId ? issue.taskId : null
  const startable = create || (!linkedTaskId && issue.status !== "done")
  const [title, setTitle] = useState(issue.title)
  const [body, setBody] = useState(issue.body)
  const [status, setStatus] = useState<IssueStatus>(issue.status)
  const [engine, setEngine] = useState(props.defaultEngine)
  const [placement, setPlacement] = useState<Placement>(PLACEMENTS[0] as Placement)
  // Follow-or-stay defaults to STAY: the board is the tracking surface.
  const [jump, setJump] = useState(false)
  const [uploading, setUploading] = useState(false)
  const refs = useRef<Partial<Record<Field, HTMLElement | null>>>({})
  const at = (field: Field) => (el: HTMLElement | null) => {
    refs.current[field] = el
  }
  const first: Field = create ? "title" : startable ? "workspace" : linkedTaskId ? "open" : "title"
  useEffect(() => refs.current[first]?.focus(), [first])

  const draft = (): Draft => ({ title: title.trim() || issue.title, body, status })
  const choice = (): StartChoice => ({ engine, placement, jump })
  const leave = (outcome: Outcome | null) => {
    closeDialog()
    if (outcome) props.onOutcome(outcome)
  }
  const needTitle = () => {
    if (title.trim()) return true
    refs.current.title?.focus()
    return false
  }
  const commit = () => {
    if (create) {
      if (needTitle()) leave({ kind: "create", title: title.trim(), body, start: choice() })
    } else if (startable) leave({ kind: "start", ...choice(), ...draft() })
    else if (linkedTaskId) leave({ kind: "open", taskId: linkedTaskId, ...draft() })
  }
  const saveOnly = () => {
    if (create && needTitle()) leave({ kind: "create", title: title.trim(), body, start: null })
  }
  const close = () => leave(create ? null : { kind: "close", ...draft() })

  const latest = useRef({ commit, saveOnly, close })
  latest.current = { commit, saveOnly, close }
  // Capture + stopImmediatePropagation: Esc here saves, so the shared dialog Esc must not also run.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const act =
        e.key === "Escape"
          ? latest.current.close
          : e.key === "Enter" && (e.ctrlKey || e.metaKey)
            ? latest.current.commit
            : e.key.toLowerCase() === "s" && e.ctrlKey && !e.metaKey
              ? latest.current.saveOnly
              : null
      if (!act) return
      e.preventDefault()
      e.stopImmediatePropagation()
      act()
    }
    window.addEventListener("keydown", onKey, { capture: true })
    return () => window.removeEventListener("keydown", onKey, { capture: true })
  }, [])

  const attach = async (files: File[]) => {
    const big = files.find((file) => file.size > MAX_ATTACHMENT_BYTES)
    if (big) {
      toast(t("pages.attachTooLarge", { name: big.name || big.type }), "error")
      return
    }
    setUploading(true)
    try {
      const paths = await Promise.all(files.map((file) => putAttachment(props.model.client, file)))
      setBody((current) => withImagePlaceholders(current, paths))
    } catch (err) {
      toast(errorText(err), "error")
    } finally {
      setUploading(false)
    }
  }
  const onPaste = (e: ClipboardEvent) => {
    const files = attachableFiles(e.clipboardData.files)
    if (files.length === 0) return
    e.preventDefault()
    void attach(files)
  }
  const onDrop = (e: DragEvent) => {
    const files = attachableFiles(e.dataTransfer.files)
    e.preventDefault()
    if (files.length > 0) void attach(files)
  }

  const cycle = <T,>(list: readonly T[], current: T, dir: 1 | -1): T =>
    list[(Math.max(0, list.indexOf(current)) + dir + list.length) % list.length] as T
  /** A selector field: ←/→/h/l (or ↑/↓ on the workspace list) steps it, Enter runs `enter`. */
  const selector = (axis: "x" | "y", step: (dir: 1 | -1) => void, enter?: () => void) => (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const dirs: Record<string, 1 | -1> =
      axis === "x" ? { ArrowRight: 1, l: 1, ArrowLeft: -1, h: -1 } : { ArrowDown: 1, ArrowUp: -1 }
    const dir = dirs[e.key]
    if (dir) step(dir)
    else if (e.key === "Enter" && enter) enter()
    else return
    e.preventDefault()
  }
  const statusTone =
    status === "done"
      ? "tone-success"
      : status === "hold"
        ? "tone-warning"
        : status === "doing"
          ? "tone-accent"
          : "muted"
  const statusLabel = (value: IssueStatus) => kanban.detail.status[value]

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && latest.current.close()}>
      <dialog
        open
        className="dialog is-wide kb-drawer"
        aria-label={create ? kanban.detail.newStory : `#${issue.id}`}
        onPaste={onPaste}
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        <div className="dialog-head">
          {create ? (
            <h1 className="kicker">{kanban.detail.newStory}</h1>
          ) : (
            <h1 className="kicker kb-drawer-head">
              <span>#{issue.id}</span>
              <span className={statusTone}>{statusLabel(status)}</span>
              <span className="muted">{fill(kanban.detail.created, { date: issue.created })}</span>
              {linkedTaskId && <span className="tone-accent">{kanban.detail.linked}</span>}
            </h1>
          )}
          {/* Esc's twin for a touch screen: saves an open story, drops a new one. */}
          <button
            type="button"
            className="dialog-close"
            aria-label={t("dialog.close")}
            title={t("dialog.close")}
            onClick={() => latest.current.close()}
          >
            ×
          </button>
        </div>
        <div className="dialog-body">
          <label className="field">
            <span className="kicker">{kanban.detail.titleLabel}</span>
            <input
              ref={at("title")}
              className="input"
              spellCheck={false}
              value={title}
              onChange={(e) => setTitle(e.target.value.replace(/[\r\n]+/g, " "))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
                  e.preventDefault()
                  refs.current.description?.focus()
                }
              }}
            />
          </label>
          <label className="field">
            <span className="kicker kb-label">
              {kanban.detail.description}
              <span className="muted kb-hint">{isTouch() ? t("pages.attachHintTouch") : kanban.detail.attachHint}</span>
              {uploading && <span className="tone-accent">…</span>}
            </span>
            <textarea
              ref={at("description")}
              className="input textarea kb-body"
              rows={8}
              spellCheck={false}
              placeholder={kanban.detail.noDescription}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>

          {!create && (
            <div className="field">
              <span className="kicker kb-label">
                {kanban.detail.statusLabel}
                <span className="muted kb-hint keys-only">←/→</span>
              </span>
              <SelectorField
                fieldRef={at("status")}
                label={kanban.detail.statusLabel}
                className="chips-row"
                onKeyDown={selector("x", (dir) => setStatus(cycle(ISSUE_STATUSES, status, dir)))}
              >
                {ISSUE_STATUSES.map((value) => (
                  <button
                    type="button"
                    key={value}
                    tabIndex={-1}
                    aria-pressed={value === status}
                    className={`chip-button ${value === status ? "is-active" : ""}`}
                    onClick={() => {
                      setStatus(value)
                      refs.current.status?.focus()
                    }}
                  >
                    {statusLabel(value)}
                  </button>
                ))}
              </SelectorField>
            </div>
          )}

          {startable ? (
            <>
              <div className="field">
                <span className="kicker kb-label">
                  {kanban.detail.engine}
                  <span className="muted kb-hint keys-only">←/→</span>
                </span>
                <SelectorField
                  fieldRef={at("engine")}
                  label={kanban.detail.engine}
                  className="chips-row"
                  onKeyDown={selector(
                    "x",
                    (dir) =>
                      setEngine(
                        cycle(
                          props.engines.map((option) => option.id),
                          engine,
                          dir,
                        ),
                      ),
                    commit,
                  )}
                >
                  {props.engines.map((option) => (
                    <button
                      type="button"
                      key={option.id}
                      tabIndex={-1}
                      aria-pressed={option.id === engine}
                      className={`chip-button ${option.id === engine ? "is-active" : ""}`}
                      onClick={() => {
                        setEngine(option.id)
                        refs.current.engine?.focus()
                      }}
                    >
                      {option.name}
                    </button>
                  ))}
                </SelectorField>
              </div>
              <div className="field">
                <span className="kicker kb-label">
                  {kanban.detail.workspace}
                  <span className="muted kb-hint keys-only">↑/↓</span>
                </span>
                <SelectorField
                  fieldRef={at("workspace")}
                  label={kanban.detail.workspace}
                  className="kb-places"
                  onKeyDown={selector("y", (dir) => setPlacement(cycle(PLACEMENTS, placement, dir)), commit)}
                >
                  {PLACEMENTS.map((option) => (
                    <button
                      type="button"
                      key={option}
                      tabIndex={-1}
                      aria-pressed={option === placement}
                      className={`kb-place ${option === placement ? "is-active" : ""}`}
                      onClick={() => {
                        setPlacement(option)
                        refs.current.workspace?.focus()
                      }}
                    >
                      {option === placement ? "▸ " : "  "}
                      {kanban.detail.placement[option]}
                    </button>
                  ))}
                </SelectorField>
              </div>
              <div className="field">
                <span className="kicker kb-label">
                  {kanban.detail.jumpLabel}
                  <span className="muted kb-hint keys-only">←/→</span>
                </span>
                <SelectorField
                  fieldRef={at("jump")}
                  label={kanban.detail.jumpLabel}
                  className="chips-row"
                  onKeyDown={selector("x", () => setJump(!jump), commit)}
                >
                  {([false, true] as const).map((follow) => (
                    <button
                      type="button"
                      key={String(follow)}
                      tabIndex={-1}
                      aria-pressed={follow === jump}
                      className={`chip-button ${follow === jump ? "is-active" : ""}`}
                      onClick={() => {
                        setJump(follow)
                        refs.current.jump?.focus()
                      }}
                    >
                      {follow ? kanban.detail.jump.follow : kanban.detail.jump.stay}
                    </button>
                  ))}
                </SelectorField>
              </div>
              <p className="muted kb-legend">
                <Legend text={deviceHint(create ? kanban.detail.createLegend : kanban.detail.startLegend)} />
              </p>
              {/* The keys' click targets: a phone has no ctrl+s or ctrl+enter. */}
              <div className="actions">
                {create && (
                  <button type="button" className="link" onClick={saveOnly}>
                    {t("pages.storySave")}
                  </button>
                )}
                <button type="button" className="button" onClick={commit}>
                  {t(create ? "pages.storySaveStart" : "pages.storyStart")}
                </button>
              </div>
            </>
          ) : linkedTaskId ? (
            <>
              <div className="field">
                <span className="kicker">{kanban.detail.sessionLabel}</span>
                <div className="chips-row kb-group">
                  <button
                    ref={at("open")}
                    type="button"
                    className="chip-button is-active"
                    onClick={() => leave({ kind: "open", taskId: linkedTaskId, ...draft() })}
                  >
                    {kanban.detail.openAction}
                  </button>
                  <button
                    ref={at("unlink")}
                    type="button"
                    className="chip-button"
                    onClick={() => leave({ kind: "unlink", ...draft() })}
                  >
                    {kanban.detail.unlinkAction}
                  </button>
                </div>
              </div>
              <EventsFeed model={props.model} taskId={linkedTaskId} />
              <p className="muted kb-legend"><Legend text={deviceHint(kanban.detail.openLegend)} /></p>
            </>
          ) : (
            <p className="muted kb-legend"><Legend text={deviceHint(kanban.detail.doneNote)} /></p>
          )}
        </div>
      </dialog>
    </div>
  )
}
