/** Desktop grouped list column of the Routines page, split out of `routines-view.tsx`. */

import type { Automation, AutomationRunStatus } from "@sma1lboy/rove-core/automations/automation-run-core.ts"
import type { ReactNode, RefObject } from "react"
import { t } from "./i18n/index.ts"
import { fill, useCopy } from "./pages-kit.ts"
import { TONE_CLASS, TONE_GLYPH, runTone } from "./routine-runs.tsx"
import { RT_GROUP, RT_LIST, RT_ROW_LINE, RT_ROW_SUB, RT_WHEN, rtNameClass, rtRowClass } from "./ui/routines.ts"
import { KICKER } from "./ui/text.ts"

export function RoutinesDesktopList(props: {
  listRef: RefObject<HTMLDivElement | null>
  header?: ReactNode
  sections: readonly { readonly key: string; readonly rows: readonly Automation[] }[]
  rows: readonly Automation[]
  cursor: number
  lastRunStatus: Readonly<Record<string, AutomationRunStatus>>
  lastFailure: Readonly<Record<string, { readonly at: string; readonly reason: string }>>
  repoName: (repo: string | undefined) => string
  triggerSub: (routine: Automation) => string
  timingLabel: (routine: Automation) => string
  engineShort: (routine: Automation) => string | undefined
  when: (iso: string | undefined) => string
  onPick: (index: number) => void
}) {
  const { auto } = useCopy()
  return (
    <div className={RT_LIST} ref={props.listRef}>
      {props.header}
      {props.sections.map((section) =>
        section.rows.length === 0 ? null : (
          <section key={section.key}>
            <h2 className={`${KICKER} ${RT_GROUP} ${section === props.sections[0] ? "text-error" : "text-muted"}`}>
              {t(section.key)}
            </h2>
            {section.rows.map((routine) => {
              const index = props.rows.indexOf(routine)
              const last = props.lastRunStatus[routine.id]
              const tone = last ? runTone(last) : null
              const failure = props.lastFailure[routine.id]
              return (
                // biome-ignore lint/a11y/useKeyWithClickEvents: the page's keys (j/k) move the cursor
                <div
                  key={routine.id}
                  data-row={index}
                  className={rtRowClass(index === props.cursor)}
                  onClick={() => props.onPick(index)}
                >
                  <span className={RT_ROW_LINE}>
                    <span className={rtNameClass(!routine.enabled)}>{routine.name}</span>
                    <span className={`mono text-muted ${RT_WHEN}`}>{props.timingLabel(routine)}</span>
                    <span className={`mono ${tone ? TONE_CLASS[tone] : "text-muted"}`} style={{ width: "1ch" }}>
                      {tone ? TONE_GLYPH[tone] : " "}
                    </span>
                  </span>
                  <span
                    className={`mono text-muted ${RT_ROW_SUB}`}
                    title={routine.schedule ?? props.triggerSub(routine)}
                  >
                    {[props.repoName(routine.repo), props.triggerSub(routine), props.engineShort(routine)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {failure ? (
                    <span className={`mono text-warning ${RT_ROW_SUB}`} title={failure.reason}>
                      {fill(auto.lastFailed, {
                        when: props.when(failure.at),
                        reason: failure.reason,
                      })}
                    </span>
                  ) : null}
                </div>
              )
            })}
          </section>
        ),
      )}
    </div>
  )
}
