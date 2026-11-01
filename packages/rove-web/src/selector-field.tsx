/**
 * A drawer or card field that is not a text box (status, engine, workspace, schedule cells): it
 * takes one Tab stop and steers with arrow keys, like the TUI's selector fields. Its options are
 * buttons kept out of the tab order.
 */

import type { KeyboardEvent, ReactNode, Ref } from "react"
import { KB_GROUP } from "./ui/kanban.ts"

const ROLE = { choice: "radiogroup", list: "listbox", cells: "group" } as const

export function SelectorField(props: {
  label: string
  /** `choice`: one of a few chips; `list`: a vertical list; `cells`: a row of editable cells. */
  kind?: keyof typeof ROLE
  className?: string
  fieldRef?: Ref<HTMLDivElement>
  onKeyDown: (e: KeyboardEvent) => void
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <div
      ref={props.fieldRef}
      role={ROLE[props.kind ?? "choice"]}
      tabIndex={0}
      aria-label={props.label}
      className={`${KB_GROUP} ${props.className ?? ""}`}
      onKeyDown={props.onKeyDown}
      onClick={props.onClick}
    >
      {props.children}
    </div>
  )
}
