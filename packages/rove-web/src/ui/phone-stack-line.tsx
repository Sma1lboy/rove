import { t } from "../i18n/index.ts"
import { type Stack, isMerged } from "../stack-data.ts"

/** A thumb-high target on a one-line strip. */
const LINK = "min-h-11 flex-none cursor-pointer whitespace-nowrap font-sans text-meta"

/**
 * A phone's stack chain under the session bar: one muted line, `main ← link ← this`, the open task in ink, Land at
 * the end in the accent. A long chain scrolls sideways under a Land that stays put, instead of wrapping onto more lines.
 */
export function PhoneStackLine(props: {
  stack: Stack
  taskId: string
  onSelect: (id: string) => void
  onLand?: () => void
}) {
  return (
    <nav
      className="flex min-w-0 flex-none items-center gap-3 px-2 font-sans text-meta text-muted"
      aria-label={t("compare.stackLabel")}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto scrollbar-none">
        {props.stack.base && <span className="flex-none text-subtle">{props.stack.base} ←</span>}
        {props.stack.nodes.map((node, i) => (
          <span key={node.id} className="flex flex-none items-center gap-2">
            {i > 0 && <span className="text-subtle">←</span>}
            <button
              type="button"
              className={`${LINK} ${node.id === props.taskId ? "text-ink" : "text-muted"}`}
              aria-current={node.id === props.taskId}
              onClick={() => props.onSelect(node.id)}
            >
              {node.label || node.title}
              {isMerged(node) && <span className="text-accent"> ✓</span>}
            </button>
          </span>
        ))}
      </span>
      {props.onLand && (
        <button type="button" className={`${LINK} text-accent`} onClick={props.onLand}>
          {t("compare.landBottomPhone")}
        </button>
      )}
    </nav>
  )
}
