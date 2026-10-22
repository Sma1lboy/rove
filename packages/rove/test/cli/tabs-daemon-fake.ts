/**
 * A daemon client whose `tabs.*` RPCs run against the REAL tab store
 * (`@sma1lboy/rove-daemon/daemon/tabs-store`) with in-memory persistence, so a
 * CLI test asserts the tabs the daemon ends up holding (and the ops it was
 * sent) instead of state.json writes. Any other request goes to `extra`, or
 * throws.
 */

import type { SharedTabs, TabOp } from "@sma1lboy/rove-daemon/daemon/tabs-ops"
import { TabsStore } from "@sma1lboy/rove-daemon/daemon/tabs-store"
import type { DaemonRpc } from "../../src/cli/daemon-session.ts"
import type { TabsState } from "../../src/tui/workspace/terminal-tabs-core.ts"

export interface TabsDaemon {
  readonly client: DaemonRpc
  readonly store: TabsStore
  /** Every `tabs.apply` in arrival order. */
  readonly applied: Array<{ taskId: string; ops: readonly TabOp[] }>
  /** Every request name, in order. */
  readonly requests: string[]
  /** The task's tabs as the daemon holds them; undefined = no record. */
  tabs(taskId: string): TabsState | undefined
}

export function tabsDaemon(
  opts: {
    /** Records the store loads at start, keyed by task id. */
    readonly seed?: Readonly<Record<string, unknown>>
    readonly extra?: Readonly<Record<string, (payload: Record<string, unknown>) => unknown>>
  } = {},
): TabsDaemon {
  const store = new TabsStore(
    { load: () => ({ ...(opts.seed ?? {}) }) as Record<string, SharedTabs>, save: () => {} },
    { publish: () => {} },
  )
  store.init()
  const applied: TabsDaemon["applied"] = []
  const requests: string[] = []
  const client: DaemonRpc = {
    subscribe: async () => ({}),
    onChannel: () => () => {},
    request: async <T>(name: string, raw?: unknown): Promise<T> => {
      requests.push(name)
      const payload = (raw ?? {}) as Record<string, unknown>
      const taskId = payload.taskId as string
      switch (name) {
        case "tabs.apply": {
          const ops = payload.ops as TabOp[]
          applied.push({ taskId, ops })
          // A JSON round trip, as over the socket: the caller never shares the store's objects.
          return JSON.parse(JSON.stringify(store.apply(taskId, ops))) as T
        }
        case "tabs.get":
          return JSON.parse(JSON.stringify(store.get(taskId))) as T
        default: {
          const handler = opts.extra?.[name]
          if (!handler) throw new Error(`unexpected daemon request ${name}`)
          return (await handler(payload)) as T
        }
      }
    },
  } as DaemonRpc
  return {
    client,
    store,
    applied,
    requests,
    tabs: (taskId) => (store.get(taskId).state ?? undefined) as TabsState | undefined,
  }
}
