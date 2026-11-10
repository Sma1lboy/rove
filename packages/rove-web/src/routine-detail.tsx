/** The Routines page's detail column: the selected routine's actions, schedule, engine, prompt and runs. */

import type { Automation, AutomationRun } from "@sma1lboy/rove/src/tui/component/automation-run-core.ts"
import { describeCronWith } from "@sma1lboy/rove/src/tui/component/cron-core.ts"
import type { BridgeClient } from "./bridge.ts"
import { t, useLocale } from "./i18n/index.ts"
import { fill, useCopy, useCronTranslate } from "./pages-kit.ts"
import { RunLog } from "./routine-run-log.tsx"
import { RoutineRuns } from "./routine-runs.tsx"
import { Button } from "./ui/button.tsx"
import { PG_ACTIONS, PG_ACTION_LINK } from "./ui/page.ts"
import { RT_HEAD, RT_META, RT_NAME, RT_PROMPT } from "./ui/routines.ts"
import { KICKER, LINK } from "./ui/text.ts"

export function RoutineDetail(props: {
  c: BridgeClient
  tick: number
  routine: Automation
  routines: readonly Automation[]
  runs: readonly AutomationRun[]
  busy: boolean
  project: string
  /** What its runs launch on; null for a script or a routine bound to an existing tab. */
  engine: string | null
  /** The bound conversation's task title, when the routine has one. */
  targetTitle: string | undefined
  now: number
  when: (iso: string | undefined) => string
  openRun: (taskId: string) => void
  onRunNow: () => void
  onToggle: () => void
  onDelete: () => void
  onChangeEngine: () => void
}) {
  const { auto } = useCopy()
  const cronT = useCronTranslate()
  const intl = useLocale() === "zh" ? "zh-CN" : "en-US"
  const { routine, busy, when } = props
  const described = describeCronWith(routine.schedule, cronT)
  const nextAt = routine.nextRunAt ? Date.parse(routine.nextRunAt) : Number.NaN
  return (
    <>
      <div className={RT_HEAD}>
        <h2 className={RT_NAME}>{routine.name}</h2>
        <span className={`mono ${PG_ACTIONS}`}>
          <button type="button" className={`${LINK} ${PG_ACTION_LINK.row}`} disabled={busy} onClick={props.onRunNow}>
            {auto.runNow}
          </button>
          <button type="button" className={`${LINK} ${PG_ACTION_LINK.row}`} disabled={busy} onClick={props.onToggle}>
            {t(routine.enabled ? "pages.routinePause" : "pages.routineEnable")}
          </button>
          <button type="button" className={`${LINK} ${PG_ACTION_LINK.row}`} disabled={busy} onClick={props.onDelete}>
            {t("pages.delete")}
          </button>
        </span>
      </div>
      <dl className={RT_META}>
        <dt className="text-muted">{t("pages.routineSchedule")}</dt>
        <dd>
          {described ?? <span className="mono">{routine.schedule}</span>}
          {described && <span className="mono text-muted">{`  ${routine.schedule}`}</span>}
        </dd>
        <dt className="text-muted">{t("pages.routineNext")}</dt>
        <dd className={routine.enabled ? "" : "text-warning"}>
          {routine.enabled
            ? Number.isFinite(nextAt)
              ? `${when(routine.nextRunAt)} · ${new Date(nextAt).toLocaleString(intl, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : "—"
            : auto.paused}
        </dd>
        <dt className="text-muted">{t("pages.routineProject")}</dt>
        <dd>{props.project}</dd>
        {/* A script routine runs a command, not an engine: nothing is delivered anywhere. */}
        {!routine.script && (
          <>
            <dt className="text-muted">{t("pages.routineDelivers")}</dt>
            <dd>
              {routine.target
                ? fill(auto.targetExisting, {
                    task: props.targetTitle ?? routine.target.taskId,
                    tab: routine.target.tabId,
                  })
                : routine.persistentSession
                  ? routine.newConversation
                    ? auto.targetStandingNew
                    : auto.targetStanding
                  : auto.targetFresh}
            </dd>
          </>
        )}
        {props.engine && (
          <>
            <dt className="text-muted">{t("pages.routineEngine")}</dt>
            <dd className="flex flex-wrap items-baseline gap-x-3.5">
              <span>{props.engine}</span>
              <Button className="font-mono" hit="tight" disabled={busy} onClick={props.onChangeEngine}>
                {t("pages.routineChangeEngine")}
              </Button>
            </dd>
          </>
        )}
      </dl>
      {routine.precheck && (
        <p className="mono text-muted">{fill(auto.precheck, { command: routine.precheck.command })}</p>
      )}
      {routine.script ? (
        <>
          <h2 className={`${KICKER} text-muted`}>{t("pages.routineScript")}</h2>
          <p className={`mono ${RT_PROMPT}`}>{routine.script.command}</p>
        </>
      ) : (
        <>
          <h2 className={`${KICKER} text-muted`}>{t("pages.routinePrompt")}</h2>
          <p className={RT_PROMPT}>{routine.prompt}</p>
        </>
      )}

      <RunLog
        c={props.c}
        tick={props.tick}
        routines={props.routines}
        followId={routine.id}
        now={props.now}
        when={when}
        openRun={props.openRun}
      />
      <RoutineRuns runs={props.runs} when={when} />
    </>
  )
}
