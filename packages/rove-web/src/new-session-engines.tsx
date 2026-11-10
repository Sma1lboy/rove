/** The composer's engine and model chips; the engine chip has a compare mode: one prompt to several engines, kept apart as sibling attempts. */

import { useState } from "react"
import { t } from "./i18n/index.ts"
import { ChipPopover, ChoiceMenu, ModelMenu } from "./new-session-menus.tsx"
import { type Choice, engineChipLabel, modelChipLabel, toggleEngine } from "./new-session.ts"
import { Button } from "./ui/button.tsx"

interface EngineRow {
  readonly id: string
  readonly name: string
  readonly ready?: boolean
}

/** What the chip shows and Start sends: the engines in pick order, and whether compare mode is on. */
export interface EnginePicks {
  readonly ids: readonly string[]
  readonly comparing: boolean
  /** Compare mode on (seeded with the current engine) or off (back to the first of the list). */
  setComparing(on: boolean): void
  /** Add or drop an engine in compare mode; the list is never emptied. */
  toggle(id: string): void
}

/**
 * The engines Start will run: the single pick, or the compare list. Compare needs a worktree per attempt, so
 * `available` (not in place, not remote, not ungrouped) gates it; a list picked before that went away is kept
 * but not used.
 */
export function useEnginePicks(
  choice: { readonly engine: string; readonly setEngine: (id: string) => void },
  available: boolean,
): EnginePicks {
  const [list, setList] = useState<readonly string[] | null>(null)
  const comparing = available && list !== null
  const ids = comparing ? list : choice.engine ? [choice.engine] : []
  return {
    ids,
    comparing,
    setComparing: (on) => setList(on ? ids : null),
    toggle(id) {
      const next = toggleEngine(ids, id)
      setList(next)
      // The first pick stays the project's engine for the model chip and the next visit.
      if (next[0] && next[0] !== choice.engine) choice.setEngine(next[0])
    },
  }
}

/** Nothing to choose between with one engine, so no chip. */
export function EngineChip(props: {
  choice: { readonly engines: readonly EngineRow[]; readonly engine: string; readonly setEngine: (id: string) => void }
  picks: EnginePicks
  /** Compare is offered; false = a plain single-engine chip. */
  available: boolean
}) {
  const { picks, choice } = props
  const engines = choice.engines
  if (engines.length < 2) return null
  const names = picks.ids.map((id) => engines.find((e) => e.id === id)?.name ?? id)
  return (
    <ChipPopover field="engine" title={t("newSession.engine")} label={engineChipLabel(names) || t("newSession.engine")}>
      {(close) => (
        <ChoiceMenu
          heading={t("newSession.engine")}
          options={engines.map((e) => ({ id: e.id, label: e.name, dim: e.ready === false }))}
          value={choice.engine}
          {...(picks.comparing ? { values: picks.ids } : {})}
          onPick={(id) => {
            if (picks.comparing) return picks.toggle(id)
            choice.setEngine(id)
            close()
          }}
          footer={
            props.available && engines.length > 1 ? (
              <Button
                className="mx-2 mt-1 mb-0.5 self-start font-mono"
                data-field="compare-engines"
                hit="tight"
                onClick={() => picks.setComparing(!picks.comparing)}
              >
                {t(picks.comparing ? "compare.oneEngine" : "compare.severalEngines")}
              </Button>
            ) : null
          }
        />
      )}
    </ChipPopover>
  )
}

export function ModelChip(props: {
  models: readonly Choice[]
  model: string
  onModel: (id: string) => void
  efforts: readonly Choice[]
  effort: string
  onEffort: (id: string) => void
}) {
  return (
    <ChipPopover
      field="model"
      title={t("newSession.model")}
      label={modelChipLabel(props.models, props.model, props.effort, t("newSession.modelDefault"))}
    >
      {(close) => <ModelMenu {...props} close={close} />}
    </ChipPopover>
  )
}
