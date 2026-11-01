/**
 * The workspace's empty state while no task exists (TUI `welcome-pane.tsx`, `first-task-start.tsx`):
 * the three keys worth knowing, what the machine can run (engines, git) with the doctor's remedy
 * when it can't run any, and a quick start on the repo `rove --web` was started in.
 */

import { formatChord } from "@sma1lboy/rove/src/tui/lib/chord-glyphs.ts"
import { useEffect, useState } from "react"
import { t, useLocale } from "./i18n/index.ts"
import { isTouch } from "./key-hints.ts"
import type { AppModel } from "./model.ts"
import { type EngineChip, type QuickStart, QuickStartDialog } from "./quick-start-dialog.tsx"
import { lastReply, requestRemembered } from "./remembered.ts"
import { useStore } from "./store.ts"
import { tc } from "./tui-copy.ts"
import { dialog } from "./ui.ts"
import { buttonClass } from "./ui/button.tsx"
import { prefixCap, prefixHint, userKeys } from "./user-keys.ts"

interface WelcomeEnv {
  readonly engines: readonly EngineChip[]
  readonly signedOut: readonly EngineChip[]
  readonly git: boolean
  readonly start: QuickStart | null
}

/** The doctor's remedy for each blocker, as `rove doctor --fix` words it: manual steps, never run. */
function fixesFor(env: WelcomeEnv): Array<{ id: string; label: string; action: string; why: string }> {
  const why = tc("doctor", "fix.humanOnlyWhy")
  const fixes = []
  if (!env.git) fixes.push({ id: "git", label: tc("doctor", "fix.git"), action: tc("doctor", "fix.gitAction"), why })
  if (env.engines.length === 0) {
    const login = env.signedOut.length > 0
    fixes.push({
      id: "engine",
      label: tc("doctor", login ? "fix.noEngineLogin" : "fix.noEngine"),
      action: tc("doctor", login ? "fix.noEngineLoginAction" : "fix.noEngineAction", {
        list: env.signedOut.map((e) => e.id).join(", "),
      }),
      why,
    })
  }
  return fixes
}

export function WelcomePane({ model }: { model: AppModel }) {
  useLocale()
  useStore(userKeys)
  const [env, setEnv] = useState<WelcomeEnv | null>(() => lastReply<WelcomeEnv>(model, "welcome.env") ?? null)
  useEffect(() => {
    let live = true
    requestRemembered<WelcomeEnv>(model, "welcome.env")
      .then((res) => live && setEnv(res))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [model])

  const steps = [
    { cap: prefixHint("task.new.global"), msg: "stepNew" },
    { cap: formatChord("f1"), msg: "stepHelp" },
    { cap: prefixCap(), msg: "stepPrefix" },
  ] as const
  const engineLine =
    env === null
      ? null
      : env.engines.length > 0
        ? { key: "enginesFound", warn: false, list: env.engines.map((e) => e.name).join(", ") }
        : env.signedOut.length > 0
          ? { key: "enginesSignedOut", warn: true, list: env.signedOut.map((e) => e.name).join(", ") }
          : { key: "enginesMissing", warn: true, list: "" }
  const fixes = env !== null && (env.engines.length === 0 || !env.git) ? fixesFor(env) : []
  const start = env?.start ?? null

  return (
    <div
      className="mx-auto flex max-w-reading flex-col gap-2.5 overflow-y-auto px-5 py-7 font-sans text-meta/normal"
      data-field="welcome"
    >
      <h1 className="m-0 font-sans text-title font-semibold text-accent">{tc("workspace", "welcome.title")}</h1>
      <p className="m-0 text-muted">{tc("workspace", "welcome.tagline")}</p>
      <dl className="keys-only m-0 flex flex-col gap-0.5 pt-1.5">
        {steps.map((step) => (
          <div key={step.msg} className="flex gap-3.5">
            <dt className="mono shrink-0 grow-0 basis-cap text-accent">{step.cap}</dt>
            <dd className="m-0 text-muted">{tc("workspace", `welcome.${step.msg}`)}</dd>
          </div>
        ))}
      </dl>
      <p className="m-0 text-muted">{tc("workspace", "welcome.worktreeExplain")}</p>
      {env !== null && engineLine !== null && (
        <div className="flex flex-col gap-1.5 pt-1.5">
          <p className={`m-0 ${engineLine.warn ? "text-warning" : "text-muted"}`}>
            {tc("workspace", `welcome.${engineLine.key}`, { list: engineLine.list })}
          </p>
          {!env.git && <p className="m-0 text-warning">{tc("workspace", "welcome.gitMissing")}</p>}
          {fixes.map((fix) => (
            <div key={fix.id} className="flex flex-col gap-0.5">
              <p className="m-0 text-warning">{fix.label}</p>
              <p className="mono m-0 text-accent">{fix.action}</p>
              <p className="m-0 text-muted">{fix.why}</p>
            </div>
          ))}
          {fixes.length > 0 && (
            <p className="m-0 text-muted">{tc("common", "failureHint", { command: "rove doctor" })}</p>
          )}
        </div>
      )}
      {env !== null && start !== null && (
        <div className="flex flex-col gap-1.5 pt-1.5">
          <button
            type="button"
            className={`${buttonClass()} self-start`}
            data-field="quick-start"
            onClick={() => dialog.set(<QuickStartDialog model={model} start={start} engines={env.engines} />)}
          >
            {tc("onboarding", "quickStart")}
          </button>
          <p className="m-0 text-muted">
            {isTouch()
              ? t("pages.quickIntentTouch")
              : tc("onboarding", "quickIntent", { key: prefixHint("task.new.global") })}
          </p>
        </div>
      )}
      <p className="m-0 pt-1.5 opacity-70 text-muted">{tc("workspace", "welcome.docsHint")}</p>
    </div>
  )
}
