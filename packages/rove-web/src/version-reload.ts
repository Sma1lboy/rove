/**
 * After an upgrade the open page reconnects to the new bridge but keeps
 * running the old bundle. The first `hello` of this page load names the rove
 * that served it; a later `hello` naming another version means the bridge was
 * replaced, so the page reloads itself to pick up the matching client. At most
 * one reload per version (remembered for the tab's session), so a bridge that
 * keeps reporting a version the page cannot reach never loops.
 */

import type { BridgeClient } from "./bridge.ts"

const RELOADED_FOR = "rove-web.reloadedFor"

export type VersionAction = "adopt" | "stay" | "reload"

/** `served`: the version the page started with (null = no hello yet). `reloadedFor`: the version the page last reloaded for. */
export function versionAction(served: string | null, reported: string, reloadedFor: string | null): VersionAction {
  if (served === null) return "adopt"
  if (reported === served || reported === reloadedFor) return "stay"
  return "reload"
}

export interface VersionWatchDeps {
  readonly storage: Pick<Storage, "getItem" | "setItem"> | null
  readonly reload: () => void
}

function browserDeps(): VersionWatchDeps {
  let storage: Storage | null = null
  try {
    storage = window.sessionStorage
  } catch {
    // Storage blocked: the page still reloads, once per version for this load.
  }
  return { storage, reload: () => window.location.reload() }
}

export function watchBridgeVersion(client: BridgeClient, deps: VersionWatchDeps = browserDeps()): () => void {
  let served: string | null = null
  let reloadedFor: string | null = null
  const read = () => {
    try {
      return deps.storage?.getItem(RELOADED_FOR) ?? reloadedFor
    } catch {
      return reloadedFor
    }
  }
  return client.conn.subscribe(() => {
    const { state, hello } = client.conn.get()
    if (state !== "open" || !hello) return
    const action = versionAction(served, hello.roveVersion, read())
    if (action === "adopt") served = hello.roveVersion
    if (action !== "reload") return
    reloadedFor = hello.roveVersion
    try {
      deps.storage?.setItem(RELOADED_FOR, hello.roveVersion)
    } catch {
      // Remembered in memory instead; this load will not reload for it twice.
    }
    deps.reload()
  })
}
