/** The Routines list on a phone: the session list's two-line rows on grouped cards, one card per section; a row leads with its engine's mark and ends with its last run's dots. */

import type { Automation, AutomationRunStatus } from "@sma1lboy/rove-core/automations/automation-run-core.ts"
import { t } from "./i18n/index.ts"
import { routineLook } from "./routines-data.ts"
import { EngineIcon, type EngineIconData } from "./ui/engine-icon.tsx"
import { PhoneStatusRow, ScriptMark } from "./ui/phone-rows.tsx"
import { PhoneGroup } from "./ui/phone.tsx"
import { LookDots } from "./ui/status-dots.tsx"

export function RoutinesPhoneList(props: {
  sections: readonly { readonly key: string; readonly rows: readonly Automation[] }[]
  lastRunStatus: Readonly<Record<string, AutomationRunStatus>>
  icons: ReadonlyMap<string, EngineIconData>
  /** The schedule in words, then when it runs next (or that it is paused). */
  line2: (routine: Automation) => string
  engine: (routine: Automation) => string | undefined
  onPick: (routine: Automation) => void
}) {
  return (
    <>
      {props.sections.map((section) =>
        section.rows.length === 0 ? null : (
          <PhoneGroup key={section.key} label={t(section.key)}>
            {section.rows.map((routine) => {
              const last = props.lastRunStatus[routine.id]
              return (
                <PhoneStatusRow
                  key={routine.id}
                  data-routine={routine.id}
                  mark={
                    routine.script ? (
                      <ScriptMark />
                    ) : (
                      <EngineIcon icon={props.icons.get(routine.vendor ?? "")} name={props.engine(routine)} />
                    )
                  }
                  title={routine.name}
                  dim={!routine.enabled}
                  line2={<span className="min-w-0 truncate">{props.line2(routine)}</span>}
                  status={<LookDots look={routineLook(last, routine.enabled)} />}
                  onClick={() => props.onPick(routine)}
                />
              )
            })}
          </PhoneGroup>
        ),
      )}
    </>
  )
}
