/**
 * Messages the composer queued for a busy tab (`send --queue`): one chip each above the message field, in
 * the order they will be pasted, each with a × that takes it back. The daemon holds them in memory and
 * pastes one per finished turn, so a chip disappears when its message went in.
 */

import { useEffect, useState } from "react"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { Button } from "./ui/button.tsx"
import { CHIPS_ROW, chipClass } from "./ui/form.ts"

interface Held {
  readonly id: string
  readonly tabId: string
  readonly text: string
}

/** Held prompts change on turn ends, not keystrokes. */
const POLL_MS = 3000
const HEAD_CHARS = 32

export function QueuedChips(props: { model: AppModel; taskId: string; tabId: string; revision: number }) {
  const { model, taskId, tabId, revision } = props
  const [held, setHeld] = useState<readonly Held[]>([])
  const [poke, setPoke] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` and `poke` are refetch triggers
  useEffect(() => {
    let live = true
    const load = () =>
      model.client.request<{ items: Held[] }>("queue.list", { taskId }).then(
        (r) => live && setHeld(r.items.filter((item) => item.tabId === tabId)),
        // A bridge older than the queue has no `queue.list`: nothing is ever held there.
        () => live && setHeld([]),
      )
    void load()
    const timer = window.setInterval(load, POLL_MS)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [model, taskId, tabId, revision, poke])
  if (held.length === 0) return null
  const cancel = (id: string) => void model.client.request("queue.cancel", { id }).finally(() => setPoke((n) => n + 1))
  return (
    <div className={CHIPS_ROW} data-field="queued">
      {held.map((item) => (
        <span key={item.id} className={chipClass(false)} title={item.text}>
          {`${t("layout.queuedChip")} · ${item.text.length > HEAD_CHARS ? `${item.text.slice(0, HEAD_CHARS)}…` : item.text} `}
          <Button
            hit="tight"
            aria-label={t("layout.queueCancel")}
            title={t("layout.queueCancel")}
            onClick={() => cancel(item.id)}
          >
            ×
          </Button>
        </span>
      ))}
    </div>
  )
}
