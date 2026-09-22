/**
 * Fold a scratch shell into the task that already owns its cwd
 * (`decideScratchAdopt`'s `fold`), rather than minting a duplicate row. HOSTED
 * sessions are re-keyed under the owner's next free tab ids (`pty.rename`,
 * the child keeps running) and adopted via `adoptTaskTabs`, which never
 * steals the active tab; the caller deletes the emptied scratch row.
 *
 * Hosted only: a local shell can't change owners, `rename` answers false and
 * it STAYS in Scratch (retried each tick).
 */

import { getSharedPtyClient } from "../../tui/panes/terminal/pty-hosted-client"
import { tabPtyKey } from "../../tui/workspace/terminal-tabs-core"
import { adoptTaskTabs } from "./terminal-tabs-adopt"
import type { TabsSnapshotKv } from "./terminal-tabs-persist"
import { knownTaskTabs } from "./terminal-tabs-shared"

export interface ScratchFoldIO {
  readonly kv: TabsSnapshotKv
  /** `pty.rename`; false = source gone, target taken, or an older host. */
  readonly rename?: (from: string, to: string) => Promise<boolean>
}

async function renameHostedSession(from: string, to: string): Promise<boolean> {
  if ((process.env.KOBE_TERMINAL_BACKEND ?? "hosted") !== "hosted") return false
  try {
    const client = await getSharedPtyClient()
    const res = await client.request<{ renamed?: boolean }>("pty.rename", { from, to })
    return res.renamed === true
  } catch {
    return false
  }
}

const tabNumber = (id: string): number => Number(/^tab-(\d+)$/.exec(id)?.[1] ?? 0)

/** Returns the folded id of the scratch's FIRST tab (for selection
 *  follow-up), or null when nothing moved; the scratch row then stays. */
export async function foldScratchShell(
  io: ScratchFoldIO,
  scratchTaskId: string,
  targetTaskId: string,
): Promise<{ activeTabId: string } | null> {
  const rename = io.rename ?? renameHostedSession
  // The scratch shell is tab-1 by construction; extra tabs the user opened
  // in the scratch task ride along under their own new ids.
  const scratchTabIds = (knownTaskTabs(io.kv, scratchTaskId)?.tabs ?? [{ id: "tab-1" }]).map((tab) => tab.id)
  let next =
    1 + (knownTaskTabs(io.kv, targetTaskId)?.tabs ?? []).reduce((max, tab) => Math.max(max, tabNumber(tab.id)), 0)
  const folded: string[] = []
  for (const tabId of scratchTabIds) {
    const from = tabPtyKey(scratchTaskId, tabId)
    // One bump retry: an unadopted orphan can occupy the computed id.
    let ok = await rename(from, tabPtyKey(targetTaskId, `tab-${next}`))
    if (!ok) {
      next++
      ok = await rename(from, tabPtyKey(targetTaskId, `tab-${next}`))
    }
    if (!ok) continue
    folded.push(`tab-${next}`)
    next++
    // The `from` handle dies in the caller's task-PTY sweep; `pty.kill` on the
    // pre-rename key is a host-side no-op, so the moved session survives.
  }
  if (folded.length === 0) return null
  adoptTaskTabs(io.kv, targetTaskId, folded)
  return { activeTabId: folded[0] as string }
}
