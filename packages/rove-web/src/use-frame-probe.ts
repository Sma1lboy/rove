/** Asks the bridge (`browser.probe`) whether an https page forbids being framed, before the Browser mounts its iframe. */

import { useEffect, useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import type { FrameProbe } from "./browser-url.ts"

/** A probe is one HEAD request; an answer this old is asked again (a site may change its headers). */
const FRESH_MS = 60_000
/** `null` = the bridge could not say (an older bridge, a lost connection): frame the page and let the browser decide. */
const answers = new Map<string, { probe: FrameProbe | null; at: number }>()

function fresh(url: string): { probe: FrameProbe | null } | null {
  const known = answers.get(url)
  return known && Date.now() - known.at < FRESH_MS ? known : null
}

/** `pending` while the probe runs (the frame waits for it); `probe` once answered. Off when `enabled` is false. */
export function useFrameProbe(
  client: BridgeClient,
  url: string,
  enabled: boolean,
): { pending: boolean; probe: FrameProbe | null } {
  const [, answered] = useState(0)
  useEffect(() => {
    if (!enabled || fresh(url)) return
    let live = true
    client
      .request<FrameProbe>("browser.probe", { url, origin: window.location.origin })
      .then(
        (probe) => answers.set(url, { probe, at: Date.now() }),
        () => answers.set(url, { probe: null, at: Date.now() }),
      )
      .then(() => live && answered((n) => n + 1))
    return () => {
      live = false
    }
  }, [client, url, enabled])
  const known = enabled ? fresh(url) : null
  return { pending: enabled && !known, probe: known?.probe ?? null }
}
