/**
 * The TUI's `SkillBanner`: while an engine set up on the Mac has no Rove agent skill, a strip
 * above the app names it and installs on click. Not dismissible; it clears once installed.
 */

import { useEffect } from "react"
import type { BridgeClient } from "./bridge.ts"
import { errorText } from "./dialogs.tsx"
import { useLocale } from "./i18n/index.ts"
import { ts } from "./settings-copy.ts"
import { createStore, useStore } from "./store.ts"
import { toast } from "./ui.ts"
import { Button } from "./ui/button.tsx"

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

export function SkillBanner({ client }: { client: BridgeClient }) {
  useLocale()
  const engines = useStore(skillMissing)
  if (engines.length === 0) return null
  return (
    // Accent, not the daemon banner's warning: nothing is broken, a step is missing.
    <output className="flex flex-wrap items-baseline gap-3 border-0 border-b-[length:var(--hairline)] border-solid border-accent bg-inset px-3.5 py-1 font-mono text-meta text-accent">
      <b>{ts("engines.skill.bannerTitle")}</b>
      <span className="text-muted">{ts("engines.skill.bannerHintWeb", { engines: engines.join(", ") })}</span>
      <Button hit="tight" onClick={() => void installSkill(client)}>
        {ts("engines.skill.bannerAction")}
      </Button>
    </output>
  )
}
