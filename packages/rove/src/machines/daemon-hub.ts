/**
 * The daemon's machine hub: connects the registered machines, follows the
 * registry on the `state` channel (`rove machine add|remove` from any shell),
 * and publishes everything clients render about other machines on `machines`.
 * Clients hold no connection of their own (`feed.ts`).
 */

import type { DaemonEventBus } from "@sma1lboy/rove-daemon/daemon/event-bus"
import type { MachinesPayload } from "@sma1lboy/rove-daemon/daemon/protocol"
import { MachineHub } from "./hub.ts"

const PUBLISH_DEBOUNCE_MS = 50

export function startDaemonMachineHub(bus: Pick<DaemonEventBus, "publish" | "onPublish">): () => void {
  const hub = new MachineHub()
  let timer: ReturnType<typeof setTimeout> | null = null
  const publish = (): void => {
    timer = null
    const live = hub.liveSignal().get()
    const payload: MachinesPayload = {
      machines: hub.machinesSignal().get(),
      tasks: hub
        .tasksSignal()
        .get()
        .map((task) => ({ ...task, kind: task.kind ?? "task", pinned: task.pinned ?? false })),
      live: {
        activity: Object.fromEntries(live.activity),
        changes: Object.fromEntries(live.changes),
        tokens: Object.fromEntries(live.tokens),
      },
    }
    bus.publish("machines", payload)
  }
  const schedule = (): void => {
    timer ??= setTimeout(publish, PUBLISH_DEBOUNCE_MS)
  }
  const stops = [hub.machinesSignal(), hub.tasksSignal(), hub.liveSignal()].map((signal) => signal.subscribe(schedule))
  let lastRegistry: string | null = null
  const offState = bus.onPublish((event) => {
    if (event.channel !== "state") return
    const state = (event.payload as { state: Record<string, unknown> }).state
    const text = JSON.stringify(state.machines ?? null)
    if (text === lastRegistry) return
    lastRegistry = text
    hub.sync()
  })
  hub.sync()
  publish()
  return () => {
    offState()
    for (const stop of stops) stop()
    if (timer) clearTimeout(timer)
    hub.dispose()
    // A late subscriber must not replay machines nobody connects any more.
    bus.publish("machines", { machines: [], tasks: [], live: { activity: {}, changes: {}, tokens: {} } })
  }
}
