/**
 * The Files pane's open action: one `[ open :PORT ]` per port where the task's own processes serve a page
 * (the dev server an agent or a shell tab started), shown in the Browser panel. No page shows nothing.
 */

import { useEffect, useState } from "react"
import type { TaskRow } from "rove-bridge/protocol"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { openBrowser } from "./panel-state.ts"
import { Button } from "./ui/button.tsx"

export interface PagePort {
  readonly port: number
  readonly url: string
  readonly command: string
}

// ponytail: a fixed poll (each read is one listener scan on the Mac); push from the daemon if this shows up in bridge load
const POLL_MS = 5000

/** The pages a task's own processes serve, read while mounted. Another machine's task has none here. */
export function usePagePorts(model: AppModel, taskId: string): PagePort[] {
  const [ports, setPorts] = useState<PagePort[]>([])
  useEffect(() => {
    setPorts([])
    let live = true
    const read = () =>
      model.client.request<{ ports: PagePort[] }>("browser.ports", { taskId }).then(
        (res) => live && setPorts(res.ports),
        () => {},
      )
    void read()
    const timer = window.setInterval(() => void read(), POLL_MS)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [model, taskId])
  return ports
}

export function PortsStrip({ model, task }: { model: AppModel; task: TaskRow }) {
  useLocale()
  const taskId = task.id
  const ports = usePagePorts(model, taskId)
  if (ports.length === 0) return null

  return (
    <div className="flex flex-wrap justify-end gap-x-3.5 gap-y-1 px-2 pb-2 font-mono text-meta whitespace-nowrap">
      {ports.map((p) => (
        <Button key={p.port} onClick={() => openBrowser(taskId, p.url)}>
          {t("files.openPort", { port: p.port })}
        </Button>
      ))}
    </div>
  )
}
