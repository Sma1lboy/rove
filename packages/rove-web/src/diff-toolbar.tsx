/** The diff view's strip above the rows: scope, hide-whitespace, totals, and the jump/fold buttons. */

import type { ReactNode } from "react"
import { t } from "./i18n/index.ts"
import { Button } from "./ui/button.tsx"
import { Tabs } from "./ui/tabs.tsx"

export function DiffToolbar<S extends string>(props: {
  scopes: { id: S; label: string }[] | null
  scope: S
  onScope: (scope: S) => void
  /** The `[ base ▾ ]` picker, when the task has a base. */
  picker: ReactNode
  ignoreWs: boolean
  onToggleWs: () => void
  files: number
  /** `effort 3/5 · 2 tests`: the rule-based shape of the change. */
  shape: string
  added: number
  removed: number
  viewed: number
  allFolded: boolean
  onFoldAll: () => void
  onNextFile: () => void
  /** Null when no comment is on screen. */
  onNextComment: (() => void) | null
}) {
  return (
    <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1 px-2 pt-1.5 font-mono text-meta">
      {props.scopes && <Tabs className="flex-wrap" tabs={props.scopes} value={props.scope} onChange={props.onScope} />}
      {props.picker}
      <Button
        hit="tight"
        aria-pressed={props.ignoreWs}
        title={t("review.ignoreWsHint")}
        className="opacity-60 aria-pressed:underline aria-pressed:opacity-100"
        onClick={props.onToggleWs}
      >
        {t("review.ignoreWs")}
      </Button>
      <span className="flex items-center gap-1.5 text-muted">
        {t("review.totals", { files: props.files, added: props.added, removed: props.removed })}
        {props.shape && <span>· {props.shape}</span>}
        {props.files > 0 && <span>· {t("review.viewedCount", { done: props.viewed, files: props.files })}</span>}
      </span>
      <span className="ml-auto flex items-center gap-x-3">
        {props.files > 1 && (
          <Button hit="tight" onClick={props.onNextFile}>
            {t("review.nextFile")}
          </Button>
        )}
        {props.onNextComment && (
          <Button hit="tight" onClick={props.onNextComment}>
            {t("review.nextComment")}
          </Button>
        )}
        {props.files > 1 && (
          <Button hit="tight" onClick={props.onFoldAll}>
            {props.allFolded ? t("review.unfoldAll") : t("review.foldAll")}
          </Button>
        )}
      </span>
    </div>
  )
}
