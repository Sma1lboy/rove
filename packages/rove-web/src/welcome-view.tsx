/**
 * The workspace's empty state while no task exists (TUI `welcome-pane.tsx`): the ringed planet,
 * a line on running agents side by side, and the one action, the New session flow.
 * What a first task needs (an engine installed, signed in, a project) is a checklist below the action,
 * each unmet line with the button that fixes it; the action itself never waits for that reply.
 */

import { useEffect, useState } from "react"
import { CelestialPlate } from "./celestial/plate.tsx"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { startShell } from "./new-session-shell.ts"
import { startNewTask } from "./new-session-view.tsx"
import { lastReply, requestRemembered } from "./remembered.ts"
import { SettingsDialog } from "./settings-view.tsx"
import { useStore } from "./store.ts"
import { tc } from "./tui-copy.ts"
import { dialog, openNewSessionFrom, toast } from "./ui.ts"
import { Button, buttonClass } from "./ui/button.tsx"
import { CK_GLYPH } from "./ui/checks.ts"
import { FIRST_RUN, FIRST_RUN_COLUMN } from "./ui/first-run.ts"
import { prefixHint, userKeys } from "./user-keys.ts"

interface EngineChip {
  readonly id: string
  readonly name: string
  /** "unknown": it runs, but Rove cannot read whether it is signed in. */
  readonly login?: "unknown"
}

interface WelcomeEnv {
  readonly engines: readonly EngineChip[]
  /** `signIn`: the shell line that reaches that engine's own login; absent from an older bridge. */
  readonly signedOut: readonly (EngineChip & { readonly signIn?: string })[]
  readonly git: boolean
  /** The repo `rove --web` was started in, offered as the composer's first project; null outside one. */
  readonly start: { readonly repo: string } | null
  /** The cwd's repo or a saved project; null = none picked yet, undefined = an older bridge that does not say. */
  readonly project?: string | null
}

interface Check {
  readonly id: "engine" | "login" | "project"
  readonly ok: boolean
  readonly label: string
  readonly fix: string
  readonly run: () => void
}

/** What a first task needs, in the order to set it up; each unmet one carries the action that fixes it here. */
function checksFor(env: WelcomeEnv, model: AppModel): Check[] {
  const names = (list: readonly EngineChip[]) => list.map((e) => e.name).join(", ")
  const installed = env.engines.length + env.signedOut.length > 0
  const login = env.signedOut[0]
  const signedIn = env.engines.filter((e) => e.login !== "unknown")
  const checks: Check[] = [
    {
      id: "engine",
      ok: installed,
      label: installed
        ? t("firstRun.engineFound", { list: names([...env.engines, ...env.signedOut]) })
        : t("firstRun.engineMissing"),
      fix: t("firstRun.engineFix"),
      run: () => dialog.set(<SettingsDialog model={model} section="engines" />),
    },
    {
      id: "login",
      ok: env.engines.length > 0,
      label:
        signedIn.length > 0
          ? t("firstRun.loginFound", { list: names(signedIn) })
          : env.engines.length > 0
            ? t("firstRun.loginUnknown", { list: names(env.engines) })
            : t(login ? "firstRun.loginMissing" : "firstRun.loginWaiting", { list: names(env.signedOut) }),
      fix: t("firstRun.loginFix", { name: login?.name ?? "" }),
      // The engine's own CLI asks for the login; a shell in a No folder session runs it.
      run: () =>
        void startShell((op, args) => model.client.request(op, args), null, login?.signIn ?? login?.id ?? "")
          .then((id) => id && model.selectWhenListed(id))
          .catch((err: unknown) => toast(err instanceof Error ? err.message : String(err), "error")),
    },
  ]
  if (env.project !== undefined) {
    checks.push({
      id: "project",
      ok: env.project !== null,
      label: env.project
        ? t("firstRun.projectFound", { name: env.project.split(/[\\/]/).pop() ?? env.project })
        : t("firstRun.projectMissing"),
      fix: t("firstRun.projectFix"),
      run: () => openNewSessionFrom({ pickProject: true }),
    })
  }
  return checks
}

export function WelcomePane({ model }: { model: AppModel }) {
  useLocale()
  useStore(userKeys)
  const [env, setEnv] = useState<WelcomeEnv | null>(() => lastReply<WelcomeEnv>(model, "welcome.env") ?? null)
  // Reread when a fix's dialog shuts and when the window comes back from a login done elsewhere.
  const dialogOpen = useStore(dialog) !== null
  useEffect(() => {
    if (dialogOpen) return
    let live = true
    const read = () =>
      requestRemembered<WelcomeEnv>(model, "welcome.env")
        .then((res) => live && setEnv(res))
        .catch(() => {})
    read()
    window.addEventListener("focus", read)
    return () => {
      live = false
      window.removeEventListener("focus", read)
    }
  }, [model, dialogOpen])

  const checks = env === null ? [] : checksFor(env, model)
  // Only the first unmet check offers its fix: signing in waits on an engine being there.
  const next = checks.find((c) => !c.ok)

  return (
    <div className={FIRST_RUN} data-field="welcome">
      <div className={FIRST_RUN_COLUMN}>
        <CelestialPlate scene="rings" />
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
        {env !== null && (
          <div className="flex w-full flex-col gap-2 font-sans text-meta" data-field="first-run-checks">
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-left">
              {checks.map((check) => (
                <li key={check.id} className="flex min-h-7 items-center gap-2" data-check={check.id} data-ok={check.ok}>
                  <span className={`mono ${CK_GLYPH} ${check.ok ? "text-success" : "text-warning"}`} aria-hidden>
                    {check.ok ? "✓" : "✗"}
                  </span>
                  <span className={`min-w-0 flex-1 ${check.ok ? "text-subtle" : "text-ink"}`}>{check.label}</span>
                  {check === next && (
                    <Button variant="action" onClick={check.run}>
                      {check.fix}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {!env.git && (
              <div className="flex flex-col gap-0.5">
                <p className="m-0 text-warning">{tc("workspace", "welcome.gitMissing")}</p>
                <p className="mono m-0 text-accent">{tc("doctor", "fix.gitAction")}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
