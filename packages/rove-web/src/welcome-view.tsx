/**
 * The workspace's empty state while no task exists (TUI `welcome-pane.tsx`): a picture of what Rove
 * is for (sessions side by side), one line on why, and the one action, the New session flow.
 * What the machine can run (engines, git) is read once and shown below the action with the
 * doctor's remedy when nothing can run; the action itself never waits for that reply.
 */

import { useEffect, useState } from "react"
import { AsciiFlow } from "./ascii-flow-view.tsx"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { startNewTask } from "./new-session-view.tsx"
import { lastReply, requestRemembered } from "./remembered.ts"
import { useStore } from "./store.ts"
import { tc } from "./tui-copy.ts"
import { buttonClass } from "./ui/button.tsx"
import { FIRST_RUN, FIRST_RUN_COLUMN } from "./ui/first-run.ts"
import { prefixHint, userKeys } from "./user-keys.ts"

interface EngineChip {
  readonly id: string
  readonly name: string
}

interface WelcomeEnv {
  readonly engines: readonly EngineChip[]
  readonly signedOut: readonly EngineChip[]
  readonly git: boolean
  /** The repo `rove --web` was started in, offered as the composer's first project; null outside one. */
  readonly start: { readonly repo: string } | null
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

  const engineLine =
    env === null
      ? null
      : env.engines.length > 0
        ? { key: "enginesFound", warn: false, list: env.engines.map((e) => e.name).join(", ") }
        : env.signedOut.length > 0
          ? { key: "enginesSignedOut", warn: true, list: env.signedOut.map((e) => e.name).join(", ") }
          : { key: "enginesMissing", warn: true, list: "" }
  const fixes = env !== null && (env.engines.length === 0 || !env.git) ? fixesFor(env) : []

  return (
    <div className={FIRST_RUN} data-field="welcome">
      <div className={FIRST_RUN_COLUMN}>
        <AsciiFlow />
        <div className="flex flex-col gap-1">
          <h1 className="m-0 font-sans text-title font-semibold text-ink">{t("firstRun.title")}</h1>
          <p className="m-0 font-sans text-body text-muted">{t("firstRun.body")}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className={buttonClass()}
            data-field="start-first-task"
            onClick={() => startNewTask(env?.start?.repo)}
          >
            {t("firstRun.start")}
          </button>
          <span className="keys-only mono text-meta text-subtle">{prefixHint("task.new.global")}</span>
        </div>
        {/* The environment's reply lands here, under the action: a late answer cannot move it. */}
        {env !== null && engineLine !== null && (
          <div className="flex flex-col gap-1.5 font-sans text-meta">
            <p className={`m-0 ${engineLine.warn ? "text-warning" : "text-subtle"}`}>
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
      </div>
    </div>
  )
}
