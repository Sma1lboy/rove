/**
 * General → Updates "check for updates": asks the registry for the CHOSEN channel's dist-tag and keeps the
 * answer for the row to show. A found update hands off to the Update page (the install flow lives there).
 */

import { useState } from "react"
import type { ReleaseChannel } from "../../../release-channels.ts"
import { type UpdateInfo, checkLatestVersion } from "../../../version"

type Checked = { readonly channel: ReleaseChannel; readonly info: UpdateInfo | null }

export type UpdateCheck = {
  /** `checking` while in flight; `null` info = the registry could not be reached (never "up to date"). */
  readonly state: "idle" | "checking" | "done"
  readonly info: UpdateInfo | null
  /** First press checks; once an update was found, the next press opens the Update page. */
  readonly press: () => void
}

export function useUpdateCheck(channel: ReleaseChannel, openUpdatePage: (() => void) | undefined): UpdateCheck {
  const [checking, setChecking] = useState(false)
  const [checked, setChecked] = useState<Checked | null>(null)
  // An answer for another channel is stale the moment the pick changes.
  const current = checked?.channel === channel ? checked : null
  async function run(): Promise<void> {
    setChecking(true)
    const info = await checkLatestVersion({ force: true, channel })
    setChecked({ channel, info })
    setChecking(false)
  }
  return {
    state: checking ? "checking" : current ? "done" : "idle",
    info: current?.info ?? null,
    press: () => {
      if (checking) return
      if (current?.info?.hasUpdate) openUpdatePage?.()
      else void run()
    },
  }
}
