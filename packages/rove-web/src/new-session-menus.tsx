/** The New session composer's popovers: a chip that opens a searchable list (project, branch) and the model/effort/engine menu. */

import { Fragment, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react"
import { t } from "./i18n/index.ts"
import { type Choice, digitRow } from "./new-session.ts"
import { Chevron } from "./ui/chevron.tsx"
import { INPUT, KICKER } from "./ui/text.ts"

/** A chip that opens a popover above itself; Esc, a click outside, or `close()` shuts it and returns focus to the chip. */
export function ChipPopover(props: {
  label: ReactNode
  title: string
  field: string
  disabled?: boolean
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  // Anchored to its chip's edge, a popover from a chip mid-row on a phone runs off the screen; slide it back in.
  useLayoutEffect(() => {
    const el = pop.current
    if (!open || !el) return
    const box = el.getBoundingClientRect()
    const shift =
      box.right > window.innerWidth - 8 ? window.innerWidth - 8 - box.right : box.left < 8 ? 8 - box.left : 0
    if (shift) el.style.transform = `translateX(${Math.round(shift)}px)`
  }, [open])
  const close = () => {
    setOpen(false)
    button.current?.focus()
  }
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener("mousedown", away)
    return () => window.removeEventListener("mousedown", away)
  }, [open])
  return (
    // Escape is caught here from the popover's own fields.
    <span
      ref={root}
      className="composer-chip-wrap"
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return
        e.preventDefault()
        e.stopPropagation()
        close()
      }}
    >
      <button
        ref={button}
        type="button"
        className="composer-chip"
        data-field={props.field}
        title={props.title}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={props.disabled}
        onClick={() => setOpen((now) => !now)}
      >
        {props.label}
      </button>
      {open && (
        <div ref={pop} className="composer-pop">
          {props.children(close)}
        </div>
      )}
    </span>
  )
}

export interface PickRow {
  readonly key: string
  readonly text: string
  /** Muted tail (a project's directory). */
  readonly dim?: string
  /** Full text of a long `dim`; the row stays one line and shows it on hover. */
  readonly title?: string
  readonly checked?: boolean
}

/** A searchable single-choice list. `extra` offers the typed text itself as a row (a path no saved project names); `more` is a second group below `rows`. */
export function SearchList(props: {
  placeholder: string
  empty: string
  rows: readonly PickRow[]
  query: string
  onQuery: (value: string) => void
  extra?: PickRow | null
  more?: readonly PickRow[]
  moreLabel?: string
  onPick: (key: string) => void
}) {
  const [cursor, setCursor] = useState(0)
  const all = [...(props.extra ? [props.extra] : []), ...props.rows, ...(props.more ?? [])]
  const at = Math.min(cursor, Math.max(0, all.length - 1))
  const active = useRef<HTMLButtonElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-scroll when the cursor or the list moves
  useEffect(() => {
    active.current?.scrollIntoView({ block: "nearest" })
  }, [at, props.rows])
  return (
    <div className="composer-list">
      <input
        className={`${INPUT} text-ink`}
        // biome-ignore lint/a11y/noAutofocus: the popover's only field
        autoFocus
        spellCheck={false}
        placeholder={props.placeholder}
        value={props.query}
        onChange={(e) => {
          setCursor(0)
          props.onQuery(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault()
            setCursor(Math.max(0, Math.min(all.length - 1, at + (e.key === "ArrowDown" ? 1 : -1))))
          } else if (e.key === "Enter") {
            e.preventDefault()
            const row = all[at]
            if (row) props.onPick(row.key)
          }
        }}
      />
      <div className="composer-rows">
        {all.length === 0 && <p className="composer-empty text-muted">{props.empty}</p>}
        {all.map((row, i) => (
          <Fragment key={row.key}>
            {props.moreLabel && row === props.more?.[0] && (
              <p className="composer-group text-muted">{props.moreLabel}</p>
            )}
            <button
              type="button"
              aria-current={row.checked === true}
              ref={i === at ? active : undefined}
              tabIndex={-1}
              title={row.title}
              className={`composer-row ${i === at ? "is-cursor" : ""}`}
              onMouseMove={() => setCursor(i)}
              onClick={() => props.onPick(row.key)}
            >
              <span className="composer-check">{row.checked ? "✓" : ""}</span>
              <span className="composer-name">{row.text}</span>
              {row.dim && (
                <span className={`composer-dim text-muted ${row.title ? "composer-clip" : ""}`}>{row.dim}</span>
              )}
            </button>
          </Fragment>
        ))}
      </div>
    </div>
  )
}

type Option = Choice & {
  readonly dim?: boolean
  /** Shown but not pickable; its label says why. */
  readonly disabled?: boolean
}

/** A radio row: check on the picked one, the row's digit (when it has one) on the others. */
function OptionRow(props: {
  option: Option
  checked: boolean
  cursor: boolean
  digit?: number
  onHover: () => void
  onPick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={props.checked}
      tabIndex={-1}
      disabled={props.option.disabled}
      className={`composer-row ${props.cursor ? "is-cursor" : ""} ${props.option.dim ? "is-dim" : ""}`}
      onMouseMove={props.onHover}
      onClick={props.onPick}
    >
      <span className="composer-check">{props.checked ? "✓" : ""}</span>
      <span>{props.option.label}</span>
      {!props.checked && props.digit !== undefined && !props.option.disabled && (
        <span className="composer-dim text-muted">{props.digit}</span>
      )}
    </button>
  )
}

/**
 * A single-choice menu under a heading. Arrows move, Enter picks, `1`-`9` pick that row when `digits`;
 * with `onBack`, Esc and Left return to the menu it came from instead of closing everything.
 */
export function ChoiceMenu(props: {
  heading: string
  options: readonly Option[]
  value: string
  onPick: (id: string) => void
  digits?: boolean
  onBack?: () => void
}) {
  const [cursor, setCursor] = useState(() =>
    Math.max(
      0,
      props.options.findIndex((o) => o.id === props.value),
    ),
  )
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => root.current?.focus(), [])
  return (
    <div
      ref={root}
      role="menu"
      tabIndex={-1}
      className="composer-menu"
      onKeyDown={(e) => {
        if (e.ctrlKey || e.metaKey || e.altKey || e.nativeEvent.isComposing) return
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault()
          setCursor(Math.max(0, Math.min(props.options.length - 1, cursor + (e.key === "ArrowDown" ? 1 : -1))))
        } else if (e.key === "Enter") {
          e.preventDefault()
          const option = props.options[cursor]
          if (option && !option.disabled) props.onPick(option.id)
        } else if (props.onBack && (e.key === "Escape" || e.key === "ArrowLeft")) {
          e.preventDefault()
          e.stopPropagation()
          props.onBack()
        } else {
          const digit = props.digits ? digitRow(e.key, props.options.length) : null
          const option = digit === null ? undefined : props.options[digit]
          if (!option || option.disabled) return
          e.preventDefault()
          props.onPick(option.id)
        }
      }}
    >
      {props.onBack ? (
        <button
          type="button"
          className={`composer-heading ${KICKER} composer-back text-muted`}
          tabIndex={-1}
          onClick={props.onBack}
        >
          ‹ {props.heading}
        </button>
      ) : (
        <p className={`composer-heading ${KICKER} text-muted`}>{props.heading}</p>
      )}
      {props.options.map((option, i) => (
        <OptionRow
          key={option.id}
          option={option}
          checked={option.id === props.value}
          cursor={i === cursor}
          digit={props.digits && i < 9 ? i + 1 : undefined}
          onHover={() => setCursor(i)}
          onPick={() => props.onPick(option.id)}
        />
      ))}
    </div>
  )
}

/**
 * The model chip's menu, as claude.ai/code's: the engine's models (`1`-`9` pick one while it is open),
 * then `Effort  <level> ›` opening the levels one step down. Models and levels come from the registry.
 */
export function ModelMenu(props: {
  models: readonly Choice[]
  model: string
  onModel: (id: string) => void
  efforts: readonly Choice[]
  effort: string
  onEffort: (id: string) => void
  close: () => void
}) {
  const [view, setView] = useState<"root" | "effort">("root")
  const rows = props.models.length + (props.efforts.length > 0 ? 1 : 0)
  const [cursor, setCursor] = useState(() =>
    Math.max(
      0,
      props.models.findIndex((m) => m.id === props.model),
    ),
  )
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (view === "root") root.current?.focus()
  }, [view])
  if (view === "effort") {
    return (
      <ChoiceMenu
        heading={t("newSession.effort")}
        options={props.efforts}
        value={props.effort}
        onBack={() => setView("root")}
        onPick={(id) => {
          props.onEffort(id)
          props.close()
        }}
      />
    )
  }
  const pickModel = (id: string) => {
    props.onModel(id)
    props.close()
  }
  const effortLabel = props.efforts.find((e) => e.id === props.effort)?.label ?? ""
  return (
    <div
      ref={root}
      role="menu"
      tabIndex={-1}
      className="composer-menu"
      onKeyDown={(e) => {
        if (e.ctrlKey || e.metaKey || e.altKey || e.nativeEvent.isComposing) return
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault()
          setCursor(Math.max(0, Math.min(rows - 1, cursor + (e.key === "ArrowDown" ? 1 : -1))))
        } else if (e.key === "Enter" || (e.key === "ArrowRight" && cursor >= props.models.length)) {
          e.preventDefault()
          const model = props.models[cursor]
          if (model) pickModel(model.id)
          else if (props.efforts.length > 0) setView("effort")
        } else {
          const digit = digitRow(e.key, props.models.length)
          const model = digit === null ? undefined : props.models[digit]
          if (!model) return
          e.preventDefault()
          pickModel(model.id)
        }
      }}
    >
      <p className={`composer-heading ${KICKER} text-muted`}>{t("newSession.modelHeading")}</p>
      {props.models.map((option, i) => (
        <OptionRow
          key={option.id}
          option={option}
          checked={option.id === props.model}
          cursor={i === cursor}
          digit={i < 9 ? i + 1 : undefined}
          onHover={() => setCursor(i)}
          onPick={() => pickModel(option.id)}
        />
      ))}
      {props.efforts.length > 0 && (
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          className={`composer-row composer-submenu ${cursor === props.models.length ? "is-cursor" : ""}`}
          onMouseMove={() => setCursor(props.models.length)}
          onClick={() => setView("effort")}
        >
          <span className="composer-check" />
          <span>{t("newSession.effort")}</span>
          <span className="composer-dim text-muted">
            {effortLabel}
            <Chevron right />
          </span>
        </button>
      )}
    </div>
  )
}

/** One picked repo's row in the Branches menu: the refs its worktree can branch from. */
export interface BranchRepo {
  readonly path: string
  readonly name: string
  readonly primary: boolean
  readonly branches: readonly string[]
  /** The repo's current branch: what "" (no pick) means. */
  readonly current: string
  /** The ref picked for it ("" = its current branch). */
  readonly base: string
}

/**
 * The composer's Branches menu, for a task over several repos: the one branch name every repo's worktree gets
 * (blank = derived), and for each repo the ref it branches from.
 */
export function BranchesMenu(props: {
  repos: readonly BranchRepo[]
  branch: string
  onBranch: (value: string) => void
  onBase: (path: string, ref: string) => void
}) {
  return (
    <div className="composer-menu composer-branches">
      <p className={`composer-heading ${KICKER} text-muted`}>{t("newSession.branches")}</p>
      <label className="composer-field">
        <span className="text-muted">{t("newSession.branchName")}</span>
        <input
          className={`${INPUT} text-ink`}
          // biome-ignore lint/a11y/noAutofocus: the menu's first field
          autoFocus
          spellCheck={false}
          placeholder={t("newSession.branchNamePlaceholder")}
          value={props.branch}
          onChange={(e) => props.onBranch(e.target.value)}
        />
      </label>
      {props.repos.map((repo) => (
        <label key={repo.path} className="composer-field">
          <span>
            {repo.name}
            {repo.primary && <span className="text-muted"> {t("newSession.primary")}</span>}
          </span>
          <select
            className={`${INPUT} text-ink`}
            aria-label={repo.name}
            value={repo.base || repo.current}
            onChange={(e) => props.onBase(repo.path, e.target.value)}
          >
            {(repo.branches.includes(repo.base || repo.current)
              ? repo.branches
              : [repo.base || repo.current, ...repo.branches]
            )
              .filter((name) => name !== "")
              .map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
          </select>
        </label>
      ))}
    </div>
  )
}
