/**
 * New session's `⋯`: the composer's rarer moves, so the bar keeps only what most sessions touch (project,
 * worktree, branch, engine, model). Machine and Later open one step down inside the same popover.
 */

import { en as tasksEn, zh as tasksZh } from "@sma1lboy/rove/src/tui/i18n/messages/tasks.ts"
import { type ReactNode, useState } from "react"
import { t, useLocale } from "./i18n/index.ts"
import { type MachineRow, machineLabel } from "./machines-view.tsx"
import { LaterField } from "./new-session-later.tsx"
import { ChipPopover, ChoiceMenu } from "./new-session-menus.tsx"
import { Chevron } from "./ui/chevron.tsx"
import * as C from "./ui/composer.ts"
import { KICKER } from "./ui/text.ts"

export function ComposerMore(props: {
  busy: boolean
  machines: readonly MachineRow[]
  /** "" = this machine. */
  machine: string
  onMachine: (alias: string) => void
  /** Absent where a scheduled start does not apply (another machine, no project, a compare round). */
  onLater?: (at: Date) => void
  onInvalid: (message: string) => void
  /** Absent while it cannot run (a compare round needs its prompt sent). */
  onCreateOnly?: () => void
  /** Clone or adopt a worktree; absent on another machine. */
  onMoreWays?: () => void
}) {
  const words = (useLocale() === "zh" ? tasksZh : tasksEn).machine
  const [view, setView] = useState<"root" | "machine" | "later">("root")
  const machineName = props.machine
    ? props.machines.find((m) => m.alias === props.machine)?.hostLabel || props.machine
    : t("newSession.thisMachine")
  return (
    <ChipPopover
      field="more"
      title={t("newSession.more")}
      label={<span aria-hidden="true">⋯</span>}
      onClose={() => setView("root")}
    >
      {(close) => {
        if (view === "machine") {
          return (
            <ChoiceMenu
              heading={t("newSession.machine")}
              options={[
                { id: "", label: t("newSession.thisMachine") },
                ...props.machines.map((m) => ({
                  id: m.alias,
                  label: machineLabel(m, words),
                  disabled: m.state !== "online",
                })),
              ]}
              value={props.machine}
              digits
              onBack={() => setView("root")}
              onPick={(id) => {
                props.onMachine(id)
                close()
              }}
            />
          )
        }
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
        const act = (fn: () => void) => () => {
          close()
          fn()
        }
        return (
          <div role="menu" className={C.MENU}>
            {props.machines.length > 0 && (
              <Row label={t("newSession.machine")} dim={machineName} sub onClick={() => setView("machine")} />
            )}
            {props.onLater && (
              <Row label={t("newSession.later")} sub disabled={props.busy} onClick={() => setView("later")} />
            )}
            {props.onCreateOnly && (
              <Row label={t("newSession.createOnly")} disabled={props.busy} onClick={act(props.onCreateOnly)} />
            )}
            {props.onMoreWays && <Row label={t("newSession.moreWays")} onClick={act(props.onMoreWays)} />}
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
