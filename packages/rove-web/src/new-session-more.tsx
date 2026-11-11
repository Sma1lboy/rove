/**
 * New session's `⋯`: the composer's rarer moves, so the bar keeps only what most sessions touch (project,
 * machine, worktree, branch, engine, model). Later opens one step down inside the same popover.
 */

import { type ReactNode, useState } from "react"
import { t } from "./i18n/index.ts"
import { LaterField } from "./new-session-later.tsx"
import { ChipPopover } from "./new-session-menus.tsx"
import { Chevron } from "./ui/chevron.tsx"
import * as C from "./ui/composer.ts"
import { KICKER } from "./ui/text.ts"

export function ComposerMore(props: {
  busy: boolean
  /** Absent where a scheduled start does not apply (another machine, no project, a compare round). */
  onLater?: (at: Date) => void
  onInvalid: (message: string) => void
}) {
  const [view, setView] = useState<"root" | "later">("root")
  return (
    <ChipPopover
      field="more"
      title={t("newSession.more")}
      label={<span aria-hidden="true">⋯</span>}
      onClose={() => setView("root")}
    >
      {(close) => {
        if (view === "later") {
          return (
            <div className={C.MENU}>
              <button type="button" className={`${C.HEADING} ${KICKER} text-muted`} onClick={() => setView("root")}>
                ‹ {t("newSession.later")}
              </button>
              <LaterField
                onBack={() => setView("root")}
                onInvalid={props.onInvalid}
                onSchedule={(at) => {
                  close()
                  props.onLater?.(at)
                }}
              />
            </div>
          )
        }
        return (
          <div role="menu" className={C.MENU}>
            {props.onLater && (
              <Row label={t("newSession.later")} sub disabled={props.busy} onClick={() => setView("later")} />
            )}
          </div>
        )
      }}
    </ChipPopover>
  )
}

function Row(props: { label: string; dim?: ReactNode; sub?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`${C.rowClass({ cursor: false })} [&:hover:not(:disabled)]:bg-hover`}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <span className={C.CLIP}>{props.label}</span>
      {(props.dim !== undefined || props.sub) && (
        <span className={`${C.SUBMENU_DIM} text-muted`}>
          {props.dim}
          {props.sub && <Chevron right />}
        </span>
      )}
    </button>
  )
}
