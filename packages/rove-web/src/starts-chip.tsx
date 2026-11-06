import { t } from "./i18n/index.ts"
import { formatStartsAt } from "./schedule-start.ts"

/** A quiet clock and the time an unstarted task's engine starts by itself (`task.scheduleStart`). */
export function StartsChip({ at }: { at: string }) {
  const when = new Date(at)
  if (Number.isNaN(when.getTime())) return null
  const text = formatStartsAt(when)
  return (
    <span className="text-subtle" title={t("rail.startsAt", { time: when.toLocaleString() })}>
      ◷ {text}
    </span>
  )
}
