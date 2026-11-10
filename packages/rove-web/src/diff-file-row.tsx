/** A file's header row in the diff: fold chevron, name, +/- counts, and its "viewed" mark. */

import { memo } from "react"
import { t } from "./i18n/index.ts"
import { Button } from "./ui/button.tsx"
import { Chevron } from "./ui/chevron.tsx"
import { Chip } from "./ui/chip.tsx"
import { DIFF_FILE_NAME, diffRowClass } from "./ui/diff-row.ts"

/** Memoised with stable callbacks: folding one file or moving the cursor leaves the other headers alone. */
export const DiffFileRow = memo(function DiffFileRow(props: {
  index: number
  name: string
  path: string | null
  closed: boolean
  viewed: boolean
  cursor: boolean
  added: number
  removed: number
  onToggleFold: (index: number, path: string | null) => void
  onToggleViewed: (path: string) => void
}) {
  return (
    <div className={`flex items-center ${props.viewed ? "opacity-60" : ""}`}>
      <Button
        variant="row"
        data-row={props.index}
        aria-expanded={!props.closed}
        aria-label={t(props.closed ? "review.unfold" : "review.fold", { path: props.name })}
        className={`${diffRowClass("file", { cursor: props.cursor, noted: false })} min-w-0 flex-1 text-left`}
        onClick={() => props.onToggleFold(props.index, props.path)}
      >
        {/* The header has no line numbers: the chevron takes the first cell and the name the rest. */}
        <span className="grid place-items-center text-subtle">
          <Chevron right={props.closed} />
        </span>
        <span className={DIFF_FILE_NAME}>
          <span className="min-w-0 truncate">{props.name}</span>
          {props.added ? <Chip tone="added">+{props.added}</Chip> : null}
          {props.removed ? <Chip tone="removed">−{props.removed}</Chip> : null}
        </span>
      </Button>
      {props.path !== null && (
        <Button
          hit="tight"
          className="flex-none px-2"
          aria-pressed={props.viewed}
          aria-label={t(props.viewed ? "review.unmarkViewed" : "review.markViewed", { path: props.name })}
          onClick={() => props.path !== null && props.onToggleViewed(props.path)}
        >
          {props.viewed ? t("review.viewedOn") : t("review.viewed")}
        </Button>
      )}
    </div>
  )
})
