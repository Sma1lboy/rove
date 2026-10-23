/**
 * Ends the alias of a migrated child once the PTY it lives in is gone: the
 * child becomes an ordinary child whose next open resumes its conversation in
 * its own `<child>::tab-1`. Fed the PTY host's session list by whoever polls
 * it, plus once at boot after the migration.
 */

import type { DaemonOrchestrator, DaemonTask, TaskPtyAlias } from "./contracts.ts"
import { logDaemonError, logDaemonInfo } from "./crash-log.ts"
import { carriedTabFields, stringField } from "./engine-tab-migration.ts"
import type { HostSession } from "./engine-tab-migration.ts"
import { ownEngineTabs } from "./engine-tabs.ts"
import { aliasKey } from "./pty-alias.ts"
import type { TabsStore } from "./tabs-store.ts"

export interface AliasKeeperDeps {
  readonly orch: Pick<DaemonOrchestrator, "listTasks" | "setPtyAlias">
  readonly tabs: Pick<TabsStore, "get" | "apply">
  readonly log?: (line: string) => void
}

export class AliasKeeper {
  /** Last session id seen on each aliased child's tab: the TUI closes the tab on exit, before the death is noticed here. */
  private readonly lastSession = new Map<string, string>()
  private running = false

  constructor(private readonly deps: AliasKeeperDeps) {}

  /** Release every alias whose PTY is not alive in `sessions`. A call during a running one is skipped; the next poll repeats it. */
  async reconcile(sessions: readonly HostSession[]): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      for (const task of this.deps.orch.listTasks()) {
        const alias = task.ptyAlias
        if (!alias || task.deletion) continue
        const aliasTab = this.deps.tabs.get(task.id).state?.tabs.find((row) => row.id === alias.tabId)
        const seen = stringField(aliasTab?.sessionId)
        if (seen) this.lastSession.set(task.id, seen)
        const session = sessions.find((s) => s.key === aliasKey(alias))
        if (session?.alive && !session.restored) continue
        await this.release(task, alias).catch((err) => logDaemonError("alias-release", err))
      }
    } finally {
      this.running = false
    }
  }

  private async release(task: DaemonTask, alias: TaskPtyAlias): Promise<void> {
    const { orch, tabs } = this.deps
    const log = this.deps.log ?? ((line: string) => logDaemonInfo("tabs-migration", line))
    const state = tabs.get(task.id).state
    const aliasTab = state?.tabs.find((row) => row.id === alias.tabId)
    const sessionId = stringField(aliasTab?.sessionId) ?? this.lastSession.get(task.id)
    await orch.setPtyAlias(task.id, null)
    this.lastSession.delete(task.id)
    log(`child ${task.id} left PTY ${aliasKey(alias)}; its next open resumes in ${task.id}::tab-1`)

    // The viewport tab names a key that is gone; the conversation goes on in an ordinary tab-1.
    // Split leaves lived in the dead key space and are not carried.
    const row = {
      ...(aliasTab ? carriedTabFields(aliasTab) : {}),
      ...(sessionId ? { sessionId, spawned: true } : {}),
      kind: "engine",
      id: "tab-1",
    }
    if (!aliasTab) {
      // The TUI already closed the tab: keep the session for whoever opens the child next.
      if (sessionId && ownEngineTabs(state?.tabs ?? []).length === 0) tabs.apply(task.id, [{ op: "open", row }])
      return
    }
    tabs.apply(task.id, [
      { op: "open", row, after: aliasTab.id },
      { op: "close", id: aliasTab.id },
      ...(state?.activeId === aliasTab.id ? [{ op: "focus" as const, id: "tab-1" }] : []),
    ])
  }
}
