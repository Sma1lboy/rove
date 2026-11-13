// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, test, vi } from "vitest"
import { BridgeClient } from "../../rove-web/src/bridge.ts"
import { AppModel } from "../../rove-web/src/model.ts"
import { openTaskRow } from "../../rove-web/src/rail-keys.ts"
import { page } from "../../rove-web/src/ui.ts"
import { Workspace } from "../../rove-web/src/workspace-view.tsx"

vi.hoisted(() => {
  for (const name of ["localStorage", "sessionStorage"]) {
    const values = new Map<string, string>()
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
      },
    })
  }
})
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const container = document.createElement("div")
document.body.append(container)
let root: ReturnType<typeof createRoot> | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  page.set(null)
  localStorage.clear()
  sessionStorage.clear()
  vi.restoreAllMocks()
})

for (const destination of ["update", "worktrees", "mods"] as const) {
  test(`${destination} survives mounting but leaves on a task pick, including the selected task`, async () => {
    const client = new BridgeClient("ws://test", "test")
    vi.spyOn(client, "request").mockImplementation(() => new Promise(() => {}))
    const model = new AppModel(client)
    model.select("first")
    page.set(destination)
    root = createRoot(container)
    await act(async () => root?.render(<Workspace model={model} narrow={false} />))
    expect(page.get()).toBe(destination)
    expect(sessionStorage.getItem("rove.web.page")).toBe(JSON.stringify(destination))

    for (const taskId of ["second", "second"]) {
      await act(async () => page.set(destination))
      await act(async () => openTaskRow(model, taskId))
      expect(model.selection.get().taskId).toBe(taskId)
      expect(page.get()).toBeNull()
      expect(sessionStorage.getItem("rove.web.page")).toBeNull()
    }
  })
}

for (const destination of ["update", "worktrees"] as const) {
  test(`a reload restores the open ${destination} page`, async () => {
    page.set(destination)
    vi.resetModules()
    const reloaded = await import("../../rove-web/src/ui.ts")
    expect(reloaded.page.get()).toBe(destination)
  })
}
