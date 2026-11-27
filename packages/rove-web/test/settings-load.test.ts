import { afterAll, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

// The i18n module reads browser globals at load.
const g = globalThis as Record<string, unknown>
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { language: "en-US", languages: ["en-US"], platform: "Linux", userAgent: "bun" },
})
const hadWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
afterAll(() => {
  if (hadWindow) Object.defineProperty(globalThis, "window", hadWindow)
  else Reflect.deleteProperty(globalThis, "window")
})
g.window ??= globalThis
const memory = new Map<string, string>()
g.localStorage ??= {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
}
const { SnippetsSection } = await import("../src/settings-snippets.tsx")
const { SectionPending } = await import("../src/settings-rows.tsx")

test("Snippets does not say there are none before a read has said so", () => {
  const model = { client: { onOpen: () => () => {} } } as never
  const html = renderToStaticMarkup(createElement(SnippetsSection, { model }))
  expect(html).not.toContain("No snippets yet")
  expect(html).toContain("loading")
})

test("a section whose read failed says why and offers a retry, instead of loading forever", () => {
  const html = renderToStaticMarkup(
    createElement(SectionPending, { failed: "not connected to rove", onRetry: () => {} }),
  )
  expect(html).toContain("Couldn&#x27;t load this: not connected to rove")
  expect(html).toContain("Retry")
})
