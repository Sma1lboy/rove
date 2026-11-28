/** The engine menu's Shell row: a terminal instead of an agent, started in the same three places a session can live. */

import { deriveTitleFromPrompt } from "@sma1lboy/rove-core/orchestrator/title.ts"
import { useState } from "react"
import { t } from "./i18n/index.ts"
import { type StartInput, spawnArgs } from "./new-session.ts"

/** Never an engine id: those carry no colon. */
export const SHELL = ":shell"

interface EngineChoice {
  readonly engines: ReadonlyArray<{ readonly id: string; readonly name: string }>
  readonly engine: string
  readonly setEngine: (id: string) => void
}

/**
 * `choice` with the Shell row last while `offered`. The pick lives in this composer only, so the engine the
 * project remembers stays an engine.
 */
export function useShellPick<C extends EngineChoice>(choice: C, offered: boolean): { on: boolean; choice: C } {
  const [picked, setPicked] = useState(false)
  const on = offered && picked
  if (!offered) return { on, choice }
  return {
    on,
    choice: {
      ...choice,
      engines: [...choice.engines, { id: SHELL, name: t("newSession.shell") }],
      engine: on ? SHELL : choice.engine,
      setEngine: (id: string) => {
        setPicked(id === SHELL)
        if (id !== SHELL) choice.setEngine(id)
      },
    },
  }
}

type Request = <T>(op: string, args?: Record<string, unknown>) => Promise<T>

/** Where the terminal opens: no folder (`null`), a project's own checkout (its path), or a new worktree of `repos`. */
export type ShellPlace = null | string | { readonly repos: StartInput["repos"]; readonly branch: string }

/** Open the session with a shell as its first tab; `command`, when given, is its first line. */
export async function startShell(request: Request, place: ShellPlace, command: string): Promise<string | undefined> {
  const line = command.trim()
  if (/[\r\n]/.test(line)) throw new Error(t("newSession.shellOneLine"))
  const run = line ? { type: line } : {}
  const title = line ? deriveTitleFromPrompt(line) : t("newSession.shell")
  if (place !== null && typeof place === "object") {
    const args = spawnArgs({ repos: place.repos, branch: place.branch, engine: "", prompt: "", model: "" })
    const res = await request<{ taskIds: string[] }>("task.spawn", { ...args, title, shell: true, ...run })
    return res.taskIds[0]
  }
  const { taskId } =
    place === null
      ? await request<{ taskId: string }>("task.openScratch", {})
      : await request<{ taskId: string }>("task.openCheckout", { repo: place, title })
  await request("tab.new", { taskId, kind: "shell", own: true, ...run })
  return taskId
}
