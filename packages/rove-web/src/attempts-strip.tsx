/** A round attempt's task page starts with its siblings: one bracketed choice per attempt, and the Compare page. */

import { attemptsOf } from "./compare-data.ts"
import { t, useLocale } from "./i18n/index.ts"
import { openCompare } from "./layout.ts"
import type { AppModel } from "./model.ts"
import { useStore } from "./store.ts"
import { Button } from "./ui/button.tsx"
import { ATTEMPTS_STRIP } from "./ui/compare.ts"
import { StatusDots } from "./ui/status-dots.tsx"

/** Nothing for a task outside a round, or one left alone in it (the others archived): it is then a plain task. */
export function AttemptsStrip({ model, taskId, groupId }: { model: AppModel; taskId: string; groupId: string }) {
  useLocale()
  const payload = useStore(model.tasks)
  const round = payload ? attemptsOf(payload.tasks, groupId) : []
  if (round.length < 2 || !round.some((row) => row.id === taskId)) return null
  return (
    <nav className={ATTEMPTS_STRIP} aria-label={t("compare.menu")}>
      {round.map((row, i) => (
        <Button
          key={row.id}
          variant="pill"
          hit="tight"
          aria-current={row.id === taskId}
          onClick={() => model.select(row.id)}
        >
          [ <StatusDots status={row.rowStatus} />
          {i + 1} {row.engine?.name ?? row.label}
          {row.kept && <span className="text-accent">✓</span>} ]
        </Button>
      ))}
      <Button hit="tight" className="ml-auto flex-none whitespace-nowrap" onClick={() => openCompare(groupId)}>
        {t("compare.strip")}
      </Button>
    </nav>
  )
}
