const TABS_PREFIX = "terminalTabs."

/**
 * Which tasks' Terminal Tabs changed. Tabs live in the persisted
 * `terminalTabs.<taskId>` snapshots (the daemon's tab store writes them for
 * every client's `tabs.apply`: TUIs, `rove api tab-new` / `update --tab`, the
 * bridge's own `tab.move`), and none of that moves a task row, so the task
 * feed never pushes for it. Diffing the snapshots covers every change; the
 * daemon's `tabs.changed` channel says the same, a debounce sooner.
 */
export class TabFeed {
  private latest: Map<string, string>
  private readonly listeners = new Set<(taskIds: readonly string[]) => void>()

  constructor(private readonly read: () => Record<string, unknown>) {
    this.latest = this.snapshots()
  }

  /** The state file changed; push the tasks whose snapshot moved. */
  check(): void {
    const next = this.snapshots()
    const changed = new Set<string>()
    for (const [id, json] of next) if (this.latest.get(id) !== json) changed.add(id)
    for (const id of this.latest.keys()) if (!next.has(id)) changed.add(id)
    this.latest = next
    if (changed.size === 0) return
    const taskIds = [...changed]
    for (const listener of this.listeners) listener(taskIds)
  }

  subscribe(listener: (taskIds: readonly string[]) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private snapshots(): Map<string, string> {
    const out = new Map<string, string>()
    for (const [key, value] of Object.entries(this.read())) {
      if (key.startsWith(TABS_PREFIX)) out.set(key.slice(TABS_PREFIX.length), JSON.stringify(value))
    }
    return out
  }
}
