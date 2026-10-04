/**
 * Recently-closed pty keys, for the sidebar's orphan-tab backstop.
 *
 * The host inventory (`useHostSessions`) is a 2s poll, so for up to one tick
 * a just-closed session still looks alive and the orphan backstop would
 * re-adopt it. Orphan detection skips keys noted here until the poll catches up.
 *
 * TTL-bounded on purpose: if the kill never lands (host unreachable), the
 * session really is an orphan and must resurface after the window.
 */

const SUPPRESS_MS = 15_000

/** `taskId::tabId` → when its tab was closed. */
const closedAt = new Map<string, number>()

/** A session key's tab-level prefix — split leaves (`…::leaf-N`) belong to
 *  their tab, same rule `orphanTabsByTask` applies. */
function tabKeyOf(key: string): string {
  return key.split("::").slice(0, 2).join("::")
}

export function noteClosedPtyKey(key: string, now = Date.now()): void {
  closedAt.set(tabKeyOf(key), now)
}

export function isRecentlyClosedPtyKey(key: string, now = Date.now()): boolean {
  const tabKey = tabKeyOf(key)
  const at = closedAt.get(tabKey)
  if (at === undefined) return false
  if (now - at > SUPPRESS_MS) {
    closedAt.delete(tabKey)
    return false
  }
  return true
}
