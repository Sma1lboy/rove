/**
 * The Files pane's run action: `[ run ]` starts the repo's `.rove/run.sh` in a shell tab of the task on a
 * port of its own, `[ stop ]` ends it, and once something listens on that port `[ open :PORT ]` shows it in
 * the Browser panel. Only a repo that ships the script shows anything.
 */

import { useEffect, useState } from "react"
import type { TaskRow } from "rove-bridge/protocol"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { openBrowser } from "./panel-state.ts"
import { toast } from "./ui.ts"
import { Button } from "./ui/button.tsx"

/** A `run.*` reply. */
interface RunState {
  readonly script: boolean
  readonly running: boolean
  readonly port: number | null
  readonly url: string | null
}

const POLL_MS = 2000

export function RunStrip({ model, task }: { model: AppModel; task: TaskRow }) {
  useLocale()
  const taskId = task.id
  const local = !task.machine
  const [state, setState] = useState<RunState | null>(null)
  const [busy, setBusy] = useState(false)
  const running = state?.running === true

  // Read when the task opens, then while it runs (the port may start listening at any time).
  useEffect(() => {
    if (!local) return
    let live = true
    const read = () =>
      model.client.request<RunState>("run.status", { taskId }).then(
        (next) => live && setState(next),
        () => {},
      )
    void read()
    const timer = running ? window.setInterval(() => void read(), POLL_MS) : 0
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [model, taskId, local, running])

  if (!local || !state?.script) return null

  const act = async (op: "run.start" | "run.stop") => {
    setBusy(true)
    try {
      setState(await model.client.request<RunState>(op, { taskId }))
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap justify-end gap-x-3.5 gap-y-1 px-2 pb-2 font-mono text-meta whitespace-nowrap">
      {state.url && (
        <Button onClick={() => state.url && openBrowser(taskId, state.url)}>
          {t("files.run.open", { port: state.port ?? "" })}
        </Button>
      )}
      <Button disabled={busy} onClick={() => void act(running ? "run.stop" : "run.start")}>
        {running ? t("files.run.stop") : t("files.run.run")}
      </Button>
    </div>
  )
}
