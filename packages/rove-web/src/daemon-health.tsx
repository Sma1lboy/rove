/**
 * "DAEMON OUT OF DATE" (TUI `VersionSkewBanner`) and its action, prefix `r` (`app.refresh`):
 * after `rove update` the daemon outlives the new build, so the bridge compares its own
 * build with the daemon's (`daemon.info`). The TUI's refresh also relaunches itself; a page
 * has no process to replace, so here it is the daemon restart (`daemon.restart`) and the
 * reconnect that follows: engine sessions live in the PTY host and keep running.
 */

import { useEffect } from "react"
import type { BridgeClient } from "./bridge.ts"
import { ConfirmDialog } from "./dialogs.tsx"
import { t, useLocale } from "./i18n/index.ts"
import { createStore, useStore } from "./store.ts"
import { tc } from "./tui-copy.ts"
import { dialog, toast } from "./ui.ts"
import { DAEMON_BANNER } from "./ui/shell.ts"
import { LINK } from "./ui/text.ts"
import { prefixHint, userKeys } from "./user-keys.ts"

interface DaemonHealth {
  readonly stale: boolean
  readonly daemonVersion: string | null
  readonly bridgeVersion: string | null
}

export const daemonHealth = createStore<DaemonHealth>({ stale: false, daemonVersion: null, bridgeVersion: null })

const POLL_MS = 20_000

async function check(client: BridgeClient): Promise<boolean> {
  try {
    const info = await client.request<{ stale: boolean; daemonVersion: string | null; bridgeVersion: string }>(
      "daemon.info",
    )
    daemonHealth.set({ stale: info.stale, daemonVersion: info.daemonVersion, bridgeVersion: info.bridgeVersion })
    return info.stale
  } catch {
    return daemonHealth.get().stale
  }
}

/** Checked on every (re)connect and every 20 s, like the TUI's daemon signals. */
export function useDaemonHealth(client: BridgeClient): void {
  useEffect(() => {
    const off = client.onOpen(() => void check(client))
    const timer = window.setInterval(() => void check(client), POLL_MS)
    return () => {
      off()
      window.clearInterval(timer)
    }
  }, [client])
}

/** Confirm, restart the daemon, then wait (bounded) for the reconnect to report the new build. */
export function refreshRove(client: BridgeClient): void {
  if (!daemonHealth.get().stale) {
    toast(tc("update", "refresh.alreadyCurrent"), "error")
    return
  }
  dialog.set(
    <ConfirmDialog
      title={tc("update", "refresh.confirmTitle")}
      body={tc("update", "refresh.confirmBody")}
      confirmLabel={tc("update", "refresh.confirmLabel")}
      onConfirm={async () => {
        await client.request("daemon.restart")
        toast(tc("update", "refresh.relaunching"))
        for (let i = 0; i < 20; i++) {
          await new Promise((resolve) => window.setTimeout(resolve, 1000))
          if (!(await check(client))) return
        }
        throw new Error(t("layout.refreshTimeout"))
      }}
    />,
  )
}

export function DaemonBanner({ onRefresh }: { onRefresh: () => void }) {
  useLocale()
  const { stale, daemonVersion, bridgeVersion } = useStore(daemonHealth)
  useStore(userKeys)
  if (!stale) return null
  const hint = tc("update", "skew.hint", {
    daemon: daemonVersion ? `v${daemonVersion}` : tc("update", "skew.olderBuild"),
    clientVersion: bridgeVersion ?? "",
    keys: prefixHint("app.refresh"),
  })
  return (
    <div className={`mono ${DAEMON_BANNER}`} role="alert">
      <b>{tc("update", "skew.title")}</b>
      <span>{hint}</span>
      <button type="button" className={LINK} onClick={onRefresh}>
        {tc("update", "refresh.confirmLabel")}
      </button>
    </div>
  )
}
