import { expect, test } from "bun:test"

// `ui.ts` reads localStorage at import; toasts time out through window.setTimeout.
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  writable: true,
  value: { getItem: () => null, setItem() {} },
})
Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: { setTimeout: () => 0 } })
const { toast, toasts } = await import("../src/ui.ts")

test("a task that re-enters an error while its card is up shows one card, not a stack", () => {
  toast("✕ daily-digest", "error")
  toast("✕ daily-digest", "error")
  toast("✕ other task", "error")
  expect(toasts.get().map((t) => t.text)).toEqual(["✕ daily-digest", "✕ other task"])
})
