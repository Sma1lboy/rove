/** A stacked task's page starts with its chain: `main ← [ #1 ✓ ] ← [ #2 ] ← [ #3 ]`, click to switch, land the bottom link. */

import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { bottomUnmerged, isMerged, stackOf } from "./stack-data.ts"
import { useStore } from "./store.ts"
import { landFlow } from "./task-flows.tsx"
import { Button } from "./ui/button.tsx"
import { ATTEMPTS_STRIP } from "./ui/compare.ts"
import { StatusDots } from "./ui/status-dots.tsx"

export function StackStrip({ model, taskId }: { model: AppModel; taskId: string }) {
  useLocale()
  const payload = useStore(model.tasks)
  const rows = payload?.tasks ?? []
  const row = rows.find((r) => r.id === taskId)
  const stack = row ? stackOf(rows, row) : null
  if (!stack) return null
  const bottom = bottomUnmerged(stack)
  return (
    <nav className={ATTEMPTS_STRIP} aria-label={t("compare.stackLabel")}>
      {stack.base && <span className="text-subtle">{stack.base} ←</span>}
      {stack.nodes.map((node, i) => (
        <span key={node.id} className="inline-flex items-center gap-x-3.5">
          {i > 0 && <span className="text-subtle">←</span>}
          <Button variant="pill" hit="tight" aria-current={node.id === taskId} onClick={() => model.select(node.id)}>
            [ <StatusDots status={node.rowStatus} />
            {node.label || node.title}
            {isMerged(node) ? <span className="text-accent">✓</span> : node.pr?.number ? <span>PR</span> : null} ]
          </Button>
        </span>
      ))}
      {bottom && !bottom.machine && (
        <Button
          hit="tight"
          className="ml-auto flex-none whitespace-nowrap"
          onClick={() => void landFlow(model, bottom)}
        >
          {t("compare.landBottom")}
        </Button>
      )}
    </nav>
  )
}
