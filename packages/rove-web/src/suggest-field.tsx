/**
 * A text input with the TUI new-task dialog's suggestion list: Up/Down move the
 * highlight, Tab completes it (and only then moves on), Enter or a click picks it.
 */

import { useEffect, useRef, useState } from "react"
import { INPUT, SUGGEST_LIST, suggestRowClass } from "./ui/text.ts"

export interface Suggestion {
  readonly key: string
  readonly text: string
  /** Muted tail (a repo's directory), after the text. */
  readonly dim?: string
  readonly accent?: boolean
}

/** Moves focus to a field of the open dialog (`data-field`). */
export function focusField(name: string): void {
  document.querySelector<HTMLElement>(`.dialog [data-field="${name}"]:not([hidden] *)`)?.focus()
}

export function SuggestField(props: {
  field: string
  value: string
  onChange: (value: string) => void
  items: readonly Suggestion[]
  /** False once a pick collapsed the list (typing reopens it). */
  open: boolean
  /** Enter or a click on row `index`. */
  onPick: (index: number) => void
  /** Tab on the highlighted row; true = consumed (the list drills deeper), false = move on. */
  onComplete?: (index: number) => boolean
  /** The highlighted row changed. */
  onCursor?: (index: number) => void
  /** Enter with no list to pick from. */
  onEnter?: () => void
  placeholder?: string
  autoFocus?: boolean
  /** Enter on a row, when it does more than a click (the branch field creates). */
  onEnterRow?: (index: number) => void
}) {
  const [cursor, setCursor] = useState(0)
  const shown = props.open && props.items.length > 0
  const at = Math.min(cursor, Math.max(0, props.items.length - 1))
  const active = useRef<HTMLLIElement>(null)
  const { onCursor } = props
  useEffect(() => onCursor?.(at), [at, onCursor])
  // Braced: newer Chromium returns a Promise from scrollIntoView, and an effect that returns it hands
  // React a "cleanup" it then calls — a TypeError that blanks the whole page on the next re-render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-scroll when the cursor or the list moves
  useEffect(() => {
    active.current?.scrollIntoView({ block: "nearest" })
  }, [at, props.items])

  const key = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!shown) return
      e.preventDefault()
      setCursor(Math.max(0, Math.min(props.items.length - 1, at + (e.key === "ArrowDown" ? 1 : -1))))
    } else if (e.key === "Tab" && !e.shiftKey && shown && props.onComplete?.(at)) {
      e.preventDefault()
      setCursor(0)
    } else if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      if (shown) {
        ;(props.onEnterRow ?? props.onPick)(at)
        setCursor(0)
      } else props.onEnter?.()
    }
  }

  return (
    <div className="relative">
      <input
        className={`${INPUT} text-ink`}
        data-field={props.field}
        spellCheck={false}
        autoComplete="off"
        // biome-ignore lint/a11y/noAutofocus: the dialog's first field
        autoFocus={props.autoFocus}
        placeholder={props.placeholder}
        value={props.value}
        onChange={(e) => {
          setCursor(0)
          props.onChange(e.target.value.replace(/[\r\n]+/g, ""))
        }}
        onKeyDown={key}
      />
      {shown && (
        <ul className={SUGGEST_LIST}>
          {props.items.map((item, i) => (
            <li key={item.key} ref={i === at ? active : undefined}>
              <button
                type="button"
                tabIndex={-1}
                aria-pressed={i === at}
                className={suggestRowClass({ cursor: i === at, accent: !!item.accent })}
                onMouseDown={(e) => {
                  e.preventDefault()
                  props.onPick(i)
                }}
              >
                <span>{item.text}</span>
                {item.dim && <span className="text-muted"> {item.dim}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
