import { expect, test } from "bun:test"

// The i18n module reads browser globals at load.
const g = globalThis as Record<string, unknown>
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { language: "en-US", languages: ["en-US"], platform: "Linux", userAgent: "bun" },
})
const memory = new Map<string, string>()
g.localStorage ??= {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
}
// Another file may have swapped `t` for its key (Bun's module mocks outlive a file): compare through `t`.
const { t } = await import("../src/i18n/index.ts")
const { engineExitText, noticeText } = await import("../src/term-notice.tsx")

test("an exit with no known code is named without a placeholder code", () => {
  expect(engineExitText(null)).toBe(t("workspace.engineExitedNoCode"))
  expect(engineExitText(2)).toBe(t("workspace.engineExited", { code: 2 }))
  expect(noticeText({ kind: "exited", code: null })).toBe(t("workspace.exitedNoCode"))
  expect(noticeText({ kind: "exited", code: 0 })).toBe(t("workspace.exited", { code: 0 }))
})
