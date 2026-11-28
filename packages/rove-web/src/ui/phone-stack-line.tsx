import type { ReactNode, RefObject } from "react"
import type { TaskRow } from "rove-bridge/protocol"
import { t } from "../i18n/index.ts"
import { type Stack, isMerged } from "../stack-data.ts"

/** A thumb-high target on a one-line strip. */
const LINK = "min-h-11 flex-none cursor-pointer whitespace-nowrap font-sans text-meta"

/**
 * A phone's stack chain under the session bar: one muted line, `main ← link ← { this ← child | sibling }`, the open task in
 * ink, Land at the end in the accent. Parallel siblings share one `{ … }` group. A long chain scrolls sideways under
 * a Land that stays put, instead of wrapping onto more lines.
 */
export function PhoneStackLine(props: {
  stack: Stack
  taskId: string
  onSelect: (id: string) => void
  onLand?: () => void
  scroller: RefObject<HTMLDivElement | null>
}) {
  const anchor = (node: TaskRow) => (
    <button
      key={node.id}
      type="button"
      className={`${LINK} max-w-[20ch] truncate ${node.id === props.taskId ? "text-ink" : "text-muted"}`}
      aria-current={node.id === props.taskId}
      title={node.title}
      onClick={() => props.onSelect(node.id)}
    >
      {node.label || node.title}
      {isMerged(node) && <span className="text-accent"> ✓</span>}
    </button>
  )
  const group = (nodes: readonly TaskRow[], link: (n: TaskRow) => ReactNode) =>
    nodes.length === 1 ? (
      link(nodes[0] as TaskRow)
    ) : (
      <span className="flex flex-none items-center gap-2">
        <span className="text-subtle">{"{"}</span>
        {nodes.map((n, i) => (
          <span key={n.id} className="flex flex-none items-center gap-2">
            {i > 0 && <span className="text-subtle">|</span>}
            {link(n)}
          </span>
        ))}
        <span className="text-subtle">{"}"}</span>
      </span>
    )
  // The open task's children hang right after it, inside its sibling group, so they read as its own.
  const link = (node: TaskRow) =>
    node.id === props.taskId && props.stack.kids.length > 0 ? (
      <span key={node.id} className="flex flex-none items-center gap-2">
        {anchor(node)}
        <span className="text-subtle">←</span>
        {group(props.stack.kids, anchor)}
      </span>
    ) : (
      anchor(node)
    )
  return (
    <nav
      className="flex min-w-0 flex-none items-center gap-3 px-2 font-sans text-meta text-muted"
      aria-label={t("compare.stackLabel")}
    >
      <div ref={props.scroller} className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto scrollbar-none">
        {props.stack.base && <span className="flex-none text-subtle">{props.stack.base} ←</span>}
        {props.stack.path.map((node) => (
          <span key={node.id} className="flex flex-none items-center gap-2">
            {anchor(node)}
            <span className="text-subtle">←</span>
          </span>
        ))}
        {group(props.stack.level, link)}
      </div>
      {props.onLand && (
        <button type="button" className={`${LINK} text-accent`} onClick={props.onLand}>
          {t("compare.landBottomPhone")}
        </button>
      )}
    </nav>
  )
}
