/** @jsxImportSource @opentui/react */
import { afterEach, expect, spyOn, test } from "bun:test"
import { useState } from "react"
import { protocolEntry } from "../../src/engine/engine-presets"
import type { EngineHistoryReader } from "../../src/engine/registry"
import { type TabLifecycleIO, useTabNaming } from "../../src/tui-react/workspace/use-tab-lifecycle"
import type { TabsState } from "../../src/tui/workspace/terminal-tabs-core"
import { act, renderComponent } from "./harness"

const history = protocolEntry("claude").history
const restorers: Array<() => void> = []
afterEach(() => {
  for (const restore of restorers.splice(0)) restore()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function namingIO(sessionId?: string) {
  const stateRef: { current: TabsState } = {
    current: {
      tabs: [
        { kind: "engine", id: "tab-1", title: null, ordinal: 1, sessionId },
        { kind: "engine", id: "tab-2", title: null, ordinal: 2, sessionId: sessionId ? `${sessionId}-2` : undefined },
      ],
      activeId: "tab-1",
      nextOrdinal: 3,
    },
  }
  const writes: TabsState[] = []
  const io: TabLifecycleIO = {
    stateRef,
    propsRef: { current: { vendor: "claude", worktree: "/naming-lifecycle" } },
    update(next) {
      writes.push(next)
      stateRef.current = next
    },
  }
  return { io, writes }
}

function Naming({ io }: { io: TabLifecycleIO }) {
  useTabNaming(io)
  return <text>naming</text>
}

async function mountNaming(io: TabLifecycleIO) {
  let unmount = () => {}
  function Host() {
    const [mounted, setMounted] = useState(true)
    unmount = () => setMounted(false)
    return mounted ? <Naming io={io} /> : <text>unmounted</text>
  }
  const rendered = await renderComponent(<Host />)
  return async () => {
    await act(async () => unmount())
    expect(await rendered.frame()).toContain("unmounted")
  }
}

test("unmount stops an awaited session discovery from writing or reading another tab", async () => {
  const started = deferred<void>()
  const pending = deferred<readonly string[]>()
  const read = spyOn(history, "listSessionIdsForWorktree").mockImplementation(() => {
    started.resolve()
    return pending.promise
  })
  restorers.push(() => read.mockRestore())
  const { io, writes } = namingIO()
  const unmount = await mountNaming(io)
  await started.promise
  await unmount()
  await act(async () => pending.resolve(["discovered-session"]))
  expect(writes).toEqual([])
  expect(read).toHaveBeenCalledTimes(1)
}, 15_000)

test("unmount stops an awaited transcript title from writing or reading another tab", async () => {
  const started = deferred<void>()
  const pending = deferred<Awaited<ReturnType<EngineHistoryReader["readHistory"]>>>()
  const read = spyOn(history, "readHistory").mockImplementation(() => {
    started.resolve()
    return pending.promise
  })
  restorers.push(() => read.mockRestore())
  const { io, writes } = namingIO("named-session")
  const unmount = await mountNaming(io)
  await started.promise
  await unmount()
  await act(async () =>
    pending.resolve([
      {
        timestamp: "2026-09-04T00:00:00Z",
        sessionId: "named-session",
        role: "user",
        blocks: [{ type: "text", text: "late title" }],
      },
    ]),
  )
  expect(writes).toEqual([])
  expect(read).toHaveBeenCalledTimes(1)
}, 15_000)
