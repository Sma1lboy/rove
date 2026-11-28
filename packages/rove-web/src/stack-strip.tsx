/**
 * A stacked task's page starts with its chain on one line: `main ← [ #1 ✓ ] ← { #2 | #2b }`. Siblings stacked on
 * the same link sit in one `{ … }` group (they run in parallel, not one after another); the open task's own
 * children follow it as `#2 ← { #3 | #3b }`. Click to switch, land the bottom link.
 */

import { type ReactNode, useEffect, useRef } from "react"
import type { TaskRow } from "rove-bridge/protocol"
import { t, useLocale } from "./i18n/index.ts"
import { useNarrow } from "./layout.ts"
import type { AppModel } from "./model.ts"
import { type Stack, bottomUnmerged, isMerged, stackOf } from "./stack-data.ts"
import { useStore } from "./store.ts"
import { landFlow } from "./task-flows.tsx"
import { Button } from "./ui/button.tsx"
import { PhoneStackLine } from "./ui/phone-stack-line.tsx"
import { StatusDots } from "./ui/status-dots.tsx"

export function StackStrip({ model, taskId }: { model: AppModel; taskId: string }) {
  useLocale()
  const narrow = useNarrow()
  const payload = useStore(model.tasks)
  const rows = payload?.tasks ?? []
  const row = rows.find((r) => r.id === taskId)
  const stack = row ? stackOf(rows, row) : null
  const scroller = useKeepCurrentInView(taskId, stack !== null)
  if (!stack) return null
  const bottom = bottomUnmerged(stack, taskId)
  const land = bottom && !bottom.machine ? () => void landFlow(model, bottom) : undefined
  const select = (id: string) => model.select(id)
  if (narrow)
    return <PhoneStackLine stack={stack} taskId={taskId} onSelect={select} onLand={land} scroller={scroller} />
  const pill = (n: TaskRow, bracket: boolean) => (
    <Button
      key={n.id}
      variant="pill"
      hit="tight"
      aria-current={n.id === taskId}
      title={n.title}
      onClick={() => select(n.id)}
    >
      {bracket && "[ "}
      <StatusDots status={n.rowStatus} />
      <span className="max-w-48 truncate">{n.label || n.title}</span>
      {isMerged(n) ? <span className="text-accent">✓</span> : n.pr?.number ? <span>PR</span> : null}
      {bracket && "]"}
    </Button>
  )
  // The open task's children hang right after it, inside its sibling group, so they read as its own.
  const node = (n: TaskRow, bracket: boolean) =>
    n.id === taskId && stack.kids.length > 0 ? (
      <span key={n.id} className="flex flex-none items-center gap-x-3.5">
        {pill(n, bracket)}
        <span className="text-subtle">←</span>
        <Group nodes={stack.kids} render={pill} />
      </span>
    ) : (
      pill(n, bracket)
    )
  return (
    <nav
      className="flex min-w-0 items-center gap-x-3.5 px-2.5 py-1 font-mono text-meta"
      aria-label={t("compare.stackLabel")}
    >
      <div ref={scroller} className="flex min-w-0 flex-1 items-center gap-x-3.5 overflow-x-auto scrollbar-none">
        {stack.base && <span className="flex-none text-subtle">{stack.base} ←</span>}
        {stack.path.map((n) => (
          <span key={n.id} className="flex flex-none items-center gap-x-3.5">
            {node(n, true)}
            <span className="text-subtle">←</span>
          </span>
        ))}
        <Group nodes={stack.level} render={node} />
      </div>
      {land && (
        <Button hit="tight" className="flex-none whitespace-nowrap" onClick={land}>
          {t("compare.landBottom")}
        </Button>
      )}
    </nav>
  )
}

/** One link of the chain: a lone task as `[ x ]`, parallel ones as `{ a | b | c }`. */
function Group({ nodes, render }: { nodes: Stack["level"]; render: (n: TaskRow, bracket: boolean) => ReactNode }) {
  if (nodes.length === 1) return render(nodes[0] as TaskRow, true)
  return (
    <span className="flex flex-none items-center gap-x-2">
      <span className="text-subtle">{"{"}</span>
      {nodes.map((n, i) => (
        <span key={n.id} className="flex items-center gap-x-2">
          {i > 0 && <span className="text-subtle">|</span>}
          {render(n, false)}
        </span>
      ))}
      <span className="text-subtle">{"}"}</span>
    </span>
  )
}

/** Scrolls the one-line strip so the open task stays visible when it changes. */
function useKeepCurrentInView(taskId: string, shown: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the open task changes or the strip appears
  useEffect(() => {
    ref.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [taskId, shown])
  return ref
}
