/**
 * Which engines set up on the Mac have no Rove agent skill (the TUI's `skill-status.ts`). The rail's Settings
 * entry shows a dot while any is listed, and Settings › Engines installs; nothing here draws a strip.
 */

import { useEffect } from "react"
import type { BridgeClient } from "./bridge.ts"
import { errorText } from "./dialogs.tsx"
import { ts } from "./settings-copy.ts"
import { createStore } from "./store.ts"
import { toast } from "./ui.ts"

/** Display names of engines lacking the skill. */
export const skillMissing = createStore<readonly string[]>([])

const POLL_MS = 30_000

export function checkSkill(client: BridgeClient): Promise<void> {
  return client.request<{ engines: string[] }>("skill.missing").then(
    (r) => skillMissing.set(r.engines),
    () => {},
  )
}

/** Checked on every (re)connect and every 30 s, so an install anywhere clears it. */
export function useSkillStatus(client: BridgeClient): void {
  useEffect(() => {
    const off = client.onOpen(() => void checkSkill(client))
    const timer = window.setInterval(() => void checkSkill(client), POLL_MS)
    return () => {
      off()
      window.clearInterval(timer)
    }
  }, [client])
}

export function installSkill(client: BridgeClient): Promise<void> {
  return client
    .request<{ error: string | null }>("skill.install")
    .then((r) => {
      if (r.error) toast(ts("engines.skill.failed", { reason: r.error }), "error")
    })
    .catch((e) => toast(errorText(e), "error"))
    .then(() => checkSkill(client))
}
