/** The Issues page's two sources, as bracket text: the one showing is plain, the other is the way to it. */

import { t, useLocale } from "./i18n/index.ts"
import { type IssuesSource, issuesSource } from "./review-queue.ts"
import { useStore } from "./store.ts"
import { Button } from "./ui/button.tsx"

const SOURCES: readonly { id: IssuesSource; label: string }[] = [
  { id: "issues", label: "reviewQueue.sourceIssues" },
  { id: "reviews", label: "reviewQueue.sourceReviews" },
]

export function SourceSwitch() {
  useLocale()
  const current = useStore(issuesSource)
  return (
    <span className="flex items-baseline gap-3 font-mono text-meta">
      {SOURCES.map((source) =>
        source.id === current ? (
          <span key={source.id} className="text-ink">
            {t(source.label as "reviewQueue.sourceIssues")}
          </span>
        ) : (
          <Button key={source.id} onClick={() => issuesSource.set(source.id)}>
            {t(source.label as "reviewQueue.sourceIssues")}
          </Button>
        ),
      )}
    </span>
  )
}
