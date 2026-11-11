/**
 * The Routines page's "LATER" block: one-shot starts the daemon holds (the composer's Later). Nothing exists for
 * them until their time; a start that failed stays here with its reason until it is cancelled.
 */

import { useEffect, useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { t } from "./i18n/index.ts"
import { errorMessage, fill, projectLabel } from "./pages-kit.ts"
import { lastReply, requestRemembered } from "./remembered.ts"
import { formatStartsAt } from "./schedule-start.ts"
import { toast } from "./ui.ts"
import { Button } from "./ui/button.tsx"
import { RT_GROUP, RT_ROW_LINE, RT_ROW_SUB, RT_WHEN, rtNameClass, rtRowClass } from "./ui/routines.ts"
import { KICKER } from "./ui/text.ts"

interface PendingStart {
  readonly id: string
  readonly at: string
  readonly title: string
  readonly repo: string
  readonly error?: string
}

export function PendingStarts(props: { client: BridgeClient; tick: number; reload: () => void }) {
  const c = props.client
  const [starts, setStarts] = useState<readonly PendingStart[]>(
    () => lastReply<{ starts: PendingStart[] }>(c, "pendingStart.list")?.starts ?? [],
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is a trigger the body doesn't read
  useEffect(() => {
    let live = true
    requestRemembered<{ starts: PendingStart[] }>(c, "pendingStart.list")
      .then((res) => live && setStarts(res.starts))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [c, props.tick])

  if (starts.length === 0) return null
  const repos = starts.map((s) => s.repo)
  const cancel = async (start: PendingStart) => {
    try {
      await c.request("pendingStart.cancel", { id: start.id })
      setStarts((prev) => prev.filter((s) => s.id !== start.id))
      props.reload()
    } catch (err) {
      toast(fill(t("pages.laterCancelFailed"), { error: errorMessage(err) }), "error")
    }
  }
  return (
    <section data-field="later" className="mt-2.5">
      <h2 className={`${KICKER} ${RT_GROUP} text-muted`}>
        {t("pages.laterStarts")} <span className="mono">{starts.length}</span>
      </h2>
      {starts.map((start) => (
        <div key={start.id} className={rtRowClass(false)}>
          <span className={RT_ROW_LINE}>
            <span className={rtNameClass(false)}>{start.title}</span>
            <span className={`mono text-muted ${RT_WHEN}`} title={new Date(start.at).toLocaleString()}>
              {formatStartsAt(new Date(start.at))}
            </span>
            <Button className="font-mono" hit="tight" onClick={() => void cancel(start)}>
              {t("pages.laterCancel")}
            </Button>
          </span>
          <span className={`mono text-muted ${RT_ROW_SUB}`}>{projectLabel(start.repo, repos)}</span>
          {start.error && (
            <span className={`mono text-warning ${RT_ROW_SUB}`} title={start.error}>
              {fill(t("pages.laterFailed"), { error: start.error })}
            </span>
          )}
        </div>
      ))}
    </section>
  )
}
