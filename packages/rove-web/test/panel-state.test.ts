import { afterAll, expect, test } from "bun:test"

// The panel modules read localStorage and the narrow media query at import.
const before = (["localStorage", "window"] as const).map(
  (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
)
afterAll(() => {
  for (const [key, descriptor] of before) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
})
const stored = new Map<string, string>()
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  writable: true,
  value: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  },
})
Object.defineProperty(globalThis, "window", {
  configurable: true,
  writable: true,
  value: { innerWidth: 1440, matchMedia: () => ({ matches: false, addEventListener() {} }) },
})
const { closePanelColumn, launchPanel, openFile, panelShown } = await import("../src/panel-state.ts")

test("a task's panel is its own: another task opening or closing one changes nothing for it", () => {
  openFile("A", "README.md")
  expect(panelShown("A")).toBe(true)
  // The reported bug: switching to a task that never opened a panel showed Files there.
  expect(panelShown("B")).toBe(false)

  launchPanel("B", "files")
  expect(panelShown("B")).toBe(true)
  // Closing B's only column shuts B's panel, by its launcher or by the column's own close.
  launchPanel("B", "files")
  expect(panelShown("B")).toBe(false)
  expect(panelShown("A")).toBe(true)

  launchPanel("B", "files")
  closePanelColumn("B", "files")
  expect(panelShown("B")).toBe(false)
  expect(panelShown("A")).toBe(true)
})
