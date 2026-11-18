/** Asks the bridge (`browser.probe`) whether an https page forbids being framed, before the Browser mounts its iframe. */

import { useEffect, useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import type { FrameProbe } from "./browser-url.ts"

/** A probe is one HEAD request; an answer this old is asked again (a site may change its headers). */
const FRESH_MS = 60_000

/** `null` = the bridge could not say (an older bridge, a lost connection): frame the page and let the browser decide. */
export interface ProbeAnswer {
  readonly probe: FrameProbe | null
  readonly at: number
}

/**
 * What is known about each address. An answer never expires out of `get`: age only decides whether to
 * ask again (`due`), so a page on screen is not unmounted because its answer got old.
 */
export class ProbeAnswers {
  private readonly known = new Map<string, ProbeAnswer>()

  get(url: string): ProbeAnswer | undefined {
    return this.known.get(url)
  }

  due(url: string, now: number): boolean {
    const answer = this.known.get(url)
    return !answer || now - answer.at >= FRESH_MS
  }

  /** A failed ask (`probe: null`) does not replace what a site already said. */
  set(url: string, probe: FrameProbe | null, now: number): void {
    if (probe === null && this.known.get(url)?.probe) return
    this.known.set(url, { probe, at: now })
  }
}

const answers = new ProbeAnswers()

/** `pending` until the first answer for `url` (the frame waits for it); `probe` once answered. Off when `enabled` is false. */
export function useFrameProbe(
  client: BridgeClient,
  url: string,
  enabled: boolean,
): { pending: boolean; probe: FrameProbe | null } {
  const [, answered] = useState(0)
  useEffect(() => {
    if (!enabled || !answers.due(url, Date.now())) return
    let live = true
    client
      .request<FrameProbe>("browser.probe", { url, origin: window.location.origin })
      .then(
        (probe) => answers.set(url, probe, Date.now()),
        () => answers.set(url, null, Date.now()),
      )
      .then(() => live && answered((n) => n + 1))
    return () => {
      live = false
    }
  }, [client, url, enabled])
  const known = enabled ? answers.get(url) : undefined
  return { pending: enabled && !known, probe: known?.probe ?? null }
}
