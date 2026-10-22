/**
 * Wires `tabs-sync.ts` to a REAL daemon tab store (`TabsStore`) through an
 * in-process `TabsTransport`, so a background tab writer's test asserts the
 * tabs the daemon ends up holding rather than a kv write. Replies take a JSON
 * round trip, as over the socket: the TUI never shares the store's objects.
 */

import type { SharedTabs } from "@sma1lboy/rove-daemon/daemon/tabs-ops"
import { type TabsChangedPayload, TabsStore } from "@sma1lboy/rove-daemon/daemon/tabs-store"
import type { TabsTransport } from "../../src/client/remote-orchestrator-tabs"
import { attachTabsTransport } from "../../src/tui-react/workspace/tabs-sync"
import type { TabsState } from "../../src/tui/workspace/terminal-tabs-core"

export interface TabsSyncDaemon {
  readonly store: TabsStore
  /** The task's tabs as the daemon holds them; undefined = no record. */
  tabs(taskId: string): TabsState | undefined
  detach(): void
}

/** Let the transport's promises (replies, reservations, the initial `tabs.list`) settle. */
export const flushTabs = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** Attach a daemon holding `seed` (task id → its tabs) and wait for its tabs to load. */
export async function attachTabsDaemon(seed: Readonly<Record<string, SharedTabs>> = {}): Promise<TabsSyncDaemon> {
  const listeners = new Set<(event: TabsChangedPayload) => void>()
  const store = new TabsStore({ load: () => wire({ ...seed }), save: () => {} }, {
    publish: (channel: string, payload: unknown) => {
      if (channel !== "tabs.changed") return
      for (const listener of listeners) listener(wire(payload as TabsChangedPayload))
    },
  } as never)
  store.init()
  const transport: TabsTransport = {
    apply: async (taskId, ops) => wire(store.apply(taskId, ops)),
    list: async () => wire(store.list()),
    reserve: async (taskId, count) => store.reserve(taskId, count),
    release: async (taskId, from, to) => store.release(taskId, from, to),
    onChanged: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  const detach = attachTabsTransport(transport)
  await flushTabs()
  return {
    store,
    tabs: (taskId) => (store.get(taskId).state ?? undefined) as TabsState | undefined,
    detach,
  }
}
