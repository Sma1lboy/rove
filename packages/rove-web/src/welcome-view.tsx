/**
 * The workspace's empty state while no task exists (TUI `welcome-pane.tsx`, `first-task-start.tsx`):
 * the three keys worth knowing, what the machine can run (engines, git) with the doctor's remedy
 * when it can't run any, and a quick start on the repo `rove --web` was started in.
 */

import { formatChord } from "@sma1lboy/rove/src/tui/lib/chord-glyphs.ts"
import { useEffect, useState } from "react"
import { useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { PREFIX_KEY } from "./prefix-state.ts"
import { type EngineChoice, type QuickStart, QuickStartDialog } from "./quick-start-dialog.tsx"
import { tc } from "./tui-copy.ts"
import { dialog } from "./ui.ts"
import "./welcome.css"

interface WelcomeEnv {
  readonly engines: readonly EngineChoice[]
  readonly signedOut: readonly EngineChoice[]
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
  const [env, setEnv] = useState<WelcomeEnv | null>(null)
  useEffect(() => {
    let live = true
    model.client
      .request<WelcomeEnv>("welcome.env")
      .then((res) => live && setEnv(res))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [model])

  const steps = [
    { cap: `${formatChord(PREFIX_KEY)} n`, msg: "stepNew" },
    { cap: formatChord("f1"), msg: "stepHelp" },
    { cap: formatChord(PREFIX_KEY), msg: "stepPrefix" },
  ] as const
  const engineLine =
    env === null
      ? null
      : env.engines.length > 0
        ? { key: "enginesFound", warn: false, list: env.engines.map((e) => e.name).join(" · ") }
        : env.signedOut.length > 0
          ? { key: "enginesSignedOut", warn: true, list: env.signedOut.map((e) => e.name).join(" · ") }
          : { key: "enginesMissing", warn: true, list: "" }
  const fixes = env !== null && (env.engines.length === 0 || !env.git) ? fixesFor(env) : []
  const start = env?.start ?? null

  return (
    <div className="welcome" data-field="welcome">
      <h1 className="welcome-title">{tc("workspace", "welcome.title")}</h1>
      <p className="muted">{tc("workspace", "welcome.tagline")}</p>
      <dl className="welcome-steps">
        {steps.map((step) => (
          <div key={step.msg} className="welcome-step">
            <dt className="welcome-cap mono">{step.cap}</dt>
            <dd className="muted">{tc("workspace", `welcome.${step.msg}`)}</dd>
          </div>
        ))}
      </dl>
      <p className="muted">{tc("workspace", "welcome.worktreeExplain")}</p>
      {env !== null && engineLine !== null && (
        <div className="welcome-env">
          <p className={engineLine.warn ? "tone-warn" : "muted"}>
            {tc("workspace", `welcome.${engineLine.key}`, { list: engineLine.list })}
          </p>
          {!env.git && <p className="tone-warn">{tc("workspace", "welcome.gitMissing")}</p>}
          {fixes.map((fix) => (
            <div key={fix.id} className="welcome-fix">
              <p className="tone-warn">{fix.label}</p>
              <p className="tone-accent mono">{fix.action}</p>
              <p className="muted">{fix.why}</p>
            </div>
          ))}
          {fixes.length > 0 && <p className="muted">{tc("common", "failureHint", { command: "rove doctor" })}</p>}
        </div>
      )}
      {env !== null && start !== null && (
        <div className="welcome-start">
          <button
            type="button"
            className="button"
            data-field="quick-start"
            onClick={() => dialog.set(<QuickStartDialog model={model} start={start} engines={env.engines} />)}
          >
            {tc("onboarding", "quickStart")}
          </button>
          <p className="muted">{tc("onboarding", "quickIntent", { key: `${formatChord(PREFIX_KEY)} n` })}</p>
        </div>
      )}
      <p className="muted welcome-docs">{tc("workspace", "welcome.docsHint")}</p>
    </div>
  )
}
