/** The New session composer's popovers: a chip that opens a searchable list (project, branch) and the choice menu the model and engine chips share. */

import { Fragment, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react"
import { t } from "./i18n/index.ts"
import { type Choice, digitRow } from "./new-session.ts"
import {
  BRANCHES,
  CHECK,
  CHIP_WRAP,
  CLIP,
  CLIP_HEAD,
  DIM,
  EMPTY_NOTE,
  FIELD,
  GROUP,
  HEADING,
  HINT,
  MENU,
  NAME,
  POP,
  ROWS,
  RULE,
  chipClass,
  rowClass,
} from "./ui/composer.ts"
import { PALETTE_INPUT } from "./ui/shell.ts"
import { INPUT, KICKER } from "./ui/text.ts"

/** A chip that opens a popover above itself; Esc, a click outside, or `close()` shuts it and returns focus to the chip. */
export function ChipPopover(props: {
  label: ReactNode
  title: string
  field: string
  disabled?: boolean
  /** Runs whenever the popover shuts, however it shut. */
  onClose?: () => void
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const onClose = useRef(props.onClose)
  onClose.current = props.onClose
  useEffect(() => {
    if (!open) onClose.current?.()
  }, [open])
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
      className={CHIP_WRAP}
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
        className={chipClass()}
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
        <div ref={pop} className={POP}>
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
  /** `dim` is a path: when it does not fit, its head is cut, not its tail. */
  readonly dimPath?: boolean
  /** Starts a new group: a hairline above it. */
  readonly ruled?: boolean
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
  /** A muted line under the rows. */
  hint?: string
  /** `add`: picked with ⌘ / Ctrl held, for a list that can hold several. */
  onPick: (key: string, add: boolean) => void
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
    <div className={MENU}>
      <input
        className={PALETTE_INPUT}
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
            if (row) props.onPick(row.key, e.metaKey || e.ctrlKey)
          }
        }}
      />
      <div className={ROWS}>
        {all.length === 0 && <p className={`${EMPTY_NOTE} text-muted`}>{props.empty}</p>}
        {all.map((row, i) => (
          <Fragment key={row.key}>
            {props.moreLabel && row === props.more?.[0] && <p className={`${GROUP} text-muted`}>{props.moreLabel}</p>}
            {row.ruled && i > 0 && <div className={RULE} />}
            <button
              type="button"
              aria-current={row.checked === true}
              ref={i === at ? active : undefined}
              tabIndex={-1}
              title={row.title}
              className={rowClass({ cursor: i === at })}
              onMouseMove={() => setCursor(i)}
              onClick={(e) => props.onPick(row.key, e.metaKey || e.ctrlKey)}
            >
              <span className={CHECK}>{row.checked ? "✓" : ""}</span>
              <span className={NAME}>{row.text}</span>
              {row.dim && (
                <span className={`${DIM} text-muted ${row.dimPath ? CLIP_HEAD : CLIP}`}>
                  {row.dimPath ? <bdi>{row.dim}</bdi> : row.dim}
                </span>
              )}
            </button>
          </Fragment>
        ))}
      </div>
      {props.hint && <p className={`${HINT} text-subtle`}>{props.hint}</p>}
    </div>
  )
}

type Option = Choice & {
  readonly dim?: boolean
  /** Shown but not pickable; its label says why. */
  readonly disabled?: boolean
}

/** A radio row: check on the picked one, the row's digit (when it has one) on the others. `multi`: a check-list row. */
function OptionRow(props: {
  option: Option
  checked: boolean
  multi: boolean
  cursor: boolean
  digit?: number
  onHover: () => void
  onPick: () => void
}) {
  return (
    <button
      type="button"
      role={props.multi ? "menuitemcheckbox" : "menuitemradio"}
      aria-checked={props.checked}
      tabIndex={-1}
      disabled={props.option.disabled}
      className={rowClass({ cursor: props.cursor, dim: props.option.dim })}
      onMouseMove={props.onHover}
      onClick={props.onPick}
    >
      <span className={CHECK}>{props.checked ? "✓" : ""}</span>
      <span>{props.option.label}</span>
      {!props.checked && props.digit !== undefined && !props.option.disabled && (
        <span className={`${DIM} text-muted`}>{props.digit}</span>
      )}
    </button>
  )
}

/**
 * A single-choice menu under a heading. Arrows move, Enter picks, `1`-`9` pick that row when `digits`;
 * with `onBack`, Esc and Left return to the menu it came from instead of closing everything.
 * `values` makes it a check-list (every id in it is checked, a pick toggles for the caller); `footer` sits under the rows.
 */
export function ChoiceMenu(props: {
  heading: string
  options: readonly Option[]
  value: string
  values?: readonly string[]
  onPick: (id: string) => void
  digits?: boolean
  onBack?: () => void
  footer?: ReactNode
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
      className={MENU}
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
        <button type="button" className={`${HEADING} ${KICKER} text-muted`} tabIndex={-1} onClick={props.onBack}>
          ‹ {props.heading}
        </button>
      ) : (
        <p className={`${HEADING} ${KICKER} text-muted`}>{props.heading}</p>
      )}
      {props.options.map((option, i) => (
        <OptionRow
          key={option.id}
          option={option}
          checked={props.values ? props.values.includes(option.id) : option.id === props.value}
          multi={props.values !== undefined}
          cursor={i === cursor}
          digit={props.digits && i < 9 ? i + 1 : undefined}
          onHover={() => setCursor(i)}
          onPick={() => props.onPick(option.id)}
        />
      ))}
      {props.footer}
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
    <div className={`${MENU} ${BRANCHES}`}>
      <p className={`${HEADING} ${KICKER} text-muted`}>{t("newSession.branches")}</p>
      <label className={FIELD}>
        <span className="text-muted">{t("newSession.branchName")}</span>
        <input
          className={INPUT}
          // biome-ignore lint/a11y/noAutofocus: the menu's first field
          autoFocus
          spellCheck={false}
          placeholder={t("newSession.branchNamePlaceholder")}
          value={props.branch}
          onChange={(e) => props.onBranch(e.target.value)}
        />
      </label>
      {props.repos.map((repo) => (
        <label key={repo.path} className={FIELD}>
          <span>
            {repo.name}
            {repo.primary && <span className="text-muted"> {t("newSession.primary")}</span>}
          </span>
          <select
            className={INPUT}
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
