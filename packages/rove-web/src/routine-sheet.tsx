/** A routine's detail on a phone: a sheet of grouped cards, its runs as two-line rows, and its actions along the foot. */

import { type AutomationRun, routineRunResponseState } from "@sma1lboy/rove/src/tui/component/automation-run-core.ts"
import { describeCronWith } from "@sma1lboy/rove/src/tui/component/cron-core.ts"
import { type ComponentProps, useState } from "react"
import { t, useLocale } from "./i18n/index.ts"
import { fill, useCopy, useCronTranslate } from "./pages-kit.ts"
import type { RoutineDetail } from "./routine-detail.tsx"
import { OUTCOMES, type Outcome, SOURCES, filterRuns, formatDuration, runDurationMs } from "./routine-run-log.ts"
import { useRunStatusText } from "./routine-run-log.tsx"
import { responseText, runErrorText } from "./routine-run-text.ts"
import { routineLook } from "./routines-data.ts"
import { PhoneStatusRow } from "./ui/phone-rows.tsx"
import { PhoneActions, PhoneFact, PhoneGroup } from "./ui/phone.tsx"
import { Segmented } from "./ui/segmented.tsx"
import { SHEET_LIST, SHEET_SEP, Sheet, SheetRow } from "./ui/sheet.tsx"
import { LookDots } from "./ui/status-dots.tsx"

/** Runs the sheet lists before it says how many more there are. */
const SHOWN = 20
const CARD_TEXT = "m-0 px-3 py-2.5 text-body whitespace-pre-wrap wrap-anywhere text-ink"

export function RoutineSheet(props: ComponentProps<typeof RoutineDetail> & { onClose: () => void }) {
  const { auto } = useCopy()
  const cronT = useCronTranslate()
  const intl = useLocale() === "zh" ? "zh-CN" : "en-US"
  const statusText = useRunStatusText()
  const [outcome, setOutcome] = useState<Outcome | "all">("all")
  const [more, setMore] = useState(false)
  const { routine, runs, busy, when } = props
  const nextAt = routine.nextRunAt ? Date.parse(routine.nextRunAt) : Number.NaN
  const shown = filterRuns(runs, outcome === "all" ? null : outcome)
  const last = filterRuns(runs, null)[0]
  const responded = runs.filter((run) => run.response)
  return (
    <Sheet label={routine.name} title={routine.name} onClose={props.onClose}>
      {() => (
        <>
          <div className={`${SHEET_LIST} gap-4 pt-1 pb-3`} data-routine-sheet>
            <PhoneGroup inset>
              <PhoneFact label={t("pages.routineSchedule")}>
                {describeCronWith(routine.schedule, cronT) ?? <span className="font-mono">{routine.schedule}</span>}
              </PhoneFact>
              <PhoneFact label={t("pages.routineNext")}>
                {routine.enabled
                  ? Number.isFinite(nextAt)
                    ? `${when(routine.nextRunAt)} · ${new Date(nextAt).toLocaleString(intl, { weekday: "short", hour: "2-digit", minute: "2-digit" })}`
                    : "—"
                  : auto.paused}
              </PhoneFact>
              {props.engine && <PhoneFact label={t("pages.routineEngine")}>{props.engine}</PhoneFact>}
              <PhoneFact label={t("pages.routineProject")}>{props.project}</PhoneFact>
              {!routine.script && (
                <PhoneFact label={t("pages.routineDelivers")}>
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
                </PhoneFact>
              )}
              <PhoneFact label={t("pages.phone.lastRun")}>
                {last ? `${statusText(last)} · ${when(last.at)}` : auto.noRuns}
              </PhoneFact>
            </PhoneGroup>

            <PhoneGroup inset label={t(routine.script ? "pages.phone.script" : "pages.phone.prompt")}>
              <p className={`${CARD_TEXT} ${routine.script ? "font-mono" : "font-sans"}`}>
                {routine.script ? routine.script.command : routine.prompt}
              </p>
              {routine.precheck && (
                <PhoneFact label={t("pages.phone.precheck")}>
                  <span className="font-mono">{routine.precheck.command}</span>
                </PhoneFact>
              )}
            </PhoneGroup>

            <div className="flex flex-col gap-2">
              <p className="m-0 px-3 font-mono text-meta text-subtle">{t("runLog.title")}</p>
              <Segmented
                label={t("runLog.title")}
                value={outcome}
                picks={[
                  { value: "all" as const, label: t("runLog.all") },
                  ...OUTCOMES.map((o) => ({ value: o, label: t(`runLog.outcome.${o}`) })),
                ]}
                onPick={setOutcome}
              />
              {shown.length === 0 ? (
                <p className="m-0 px-3 font-sans text-body text-muted">
                  {runs.length === 0 ? auto.noRuns : t("runLog.empty")}
                </p>
              ) : (
                <PhoneGroup inset>
                  {shown.slice(0, SHOWN).map((run) => (
                    <RunRow
                      key={run.id}
                      run={run}
                      status={statusText(run)}
                      now={props.now}
                      when={when}
                      open={props.openRun}
                    />
                  ))}
                </PhoneGroup>
              )}
              {shown.length > SHOWN && (
                <p className="m-0 px-3 font-sans text-meta text-muted">
                  {t("runLog.more", { count: shown.length - SHOWN })}
                </p>
              )}
            </div>

            <PhoneGroup inset label={t("pages.phone.responses")}>
              {responded.length === 0 ? (
                <p className={`${CARD_TEXT} font-sans text-muted`}>{t("pages.phone.noResponses")}</p>
              ) : (
                responded.map((run) => (
                  <div key={run.id} className="flex flex-col gap-1 px-3 py-2.5">
                    <span className="font-mono text-meta text-muted">{`#${run.runNumber} · ${when(run.response?.at)}`}</span>
                    <p className="m-0 font-sans text-body whitespace-pre-wrap wrap-anywhere text-ink">
                      {responseText(run.response?.text ?? "")}
                    </p>
                  </div>
                ))
              )}
            </PhoneGroup>
          </div>
          <div className="flex flex-none px-3 pt-2">
            <PhoneActions
              actions={[
                { label: t("pages.phone.more"), glyph: "⋯", onClick: () => setMore(true) },
                {
                  label: t(routine.enabled ? "pages.phone.pause" : "pages.phone.enable"),
                  disabled: busy,
                  onClick: props.onToggle,
                },
                { label: t("pages.phone.runNow"), tone: "accent", disabled: busy, onClick: props.onRunNow },
              ]}
            />
          </div>
          {more && (
            <Sheet label={t("pages.phone.more")} onClose={() => setMore(false)}>
              {(close) => (
                <div className={SHEET_LIST}>
                  {props.engine && (
                    <SheetRow
                      onClick={() => {
                        props.onClose()
                        props.onChangeEngine()
                      }}
                    >
                      {t("pages.phone.changeEngine")}
                    </SheetRow>
                  )}
                  {props.engine && <hr className={SHEET_SEP} />}
                  <SheetRow
                    tone="danger"
                    data-routine-delete
                    onClick={() => {
                      props.onClose()
                      props.onDelete()
                    }}
                  >
                    {t("pages.phone.deleteRoutine")}
                  </SheetRow>
                  <SheetRow tone="cancel" onClick={close}>
                    {t("menu.cancel")}
                  </SheetRow>
                </div>
              )}
            </Sheet>
          )}
        </>
      )}
    </Sheet>
  )
}

/** One run: what it came to over what fired it (and why it failed), its dots over when it ran. A run with a session opens it. */
function RunRow(props: {
  run: AutomationRun
  status: string
  now: number
  when: (iso: string | undefined) => string
  open: (taskId: string) => void
}) {
  const { auto } = useCopy()
  const { run } = props
  const state = routineRunResponseState(run, props.now)
  const duration = runDurationMs(run)
  const taskId = run.taskId
  const line = [
    t(`runLog.source.${SOURCES[run.trigger]}`),
    duration !== null ? formatDuration(duration) : null,
    state === "awaiting" ? auto.responseAwaiting : state === "missing" ? auto.responseMissing : null,
    run.error ? runErrorText(run.error).summary : null,
  ]
  return (
    <PhoneStatusRow
      mark={null}
      title={`#${run.runNumber} ${props.status}`}
      line2={<span className="min-w-0 truncate">{line.filter(Boolean).join(" · ")}</span>}
      top={<LookDots look={routineLook(run.status, true)} />}
      bottom={props.when(run.at)}
      disabled={!taskId}
      onClick={() => taskId && props.open(taskId)}
    />
  )
}
