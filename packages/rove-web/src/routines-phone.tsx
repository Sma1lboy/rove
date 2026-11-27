/** The Routines list on a phone: the session list's two-line rows on grouped cards, one card per section. */

import type { Automation, AutomationRun } from "@sma1lboy/rove/src/tui/component/automation-run-core.ts"
import { t } from "./i18n/index.ts"
import { compactAge } from "./inbox.ts"
import { TONE_CLASS, TONE_GLYPH, runTone } from "./routine-runs.tsx"
import { PHONE_MARK, PhoneStatusRow } from "./ui/phone-rows.tsx"
import { PhoneGroup } from "./ui/phone.tsx"

export function RoutinesPhoneList(props: {
  sections: readonly { readonly key: string; readonly rows: readonly Automation[] }[]
  lastRunStatus: Readonly<Record<string, string>>
  runs: Readonly<Record<string, readonly AutomationRun[]>>
  now: number
  /** The schedule in words, then when it runs next (or that it is paused). */
  line2: (routine: Automation) => string
  engine: (routine: Automation) => string | undefined
  onPick: (routine: Automation) => void
}) {
  return (
    <>
      {props.sections.map((section) =>
        section.rows.length === 0 ? null : (
          <PhoneGroup key={section.key} label={`${t(section.key)} ${section.rows.length}`}>
            {section.rows.map((routine) => {
              const last = props.lastRunStatus[routine.id]
              const tone = last ? runTone(last) : null
              const ranAt = Date.parse(props.runs[routine.id]?.[0]?.at ?? "")
              return (
                <PhoneStatusRow
                  key={routine.id}
                  data-routine={routine.id}
                  mark={
                    <span className={`${PHONE_MARK} ${tone ? TONE_CLASS[tone] : "text-subtle"}`} aria-hidden="true">
                      {tone ? TONE_GLYPH[tone] : "○"}
                    </span>
                  }
                  title={routine.name}
                  dim={!routine.enabled}
                  line2={<span className="min-w-0 truncate">{props.line2(routine)}</span>}
                  top={Number.isFinite(ranAt) ? compactAge(props.now - ranAt) : "—"}
                  bottom={props.engine(routine)}
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
