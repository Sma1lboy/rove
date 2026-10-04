import { describe, expect, it } from "vitest"
import { engineSessionIdFromTitle, isEnginePlaceholderTitle } from "../../src/engine/registry.ts"

/**
 * Codex writes its THREAD ID into the OSC title until the thread is named
 * (`tui.terminal_title=["activity","thread-title"]` documents itself as "the
 * thread title, or the thread identifier when unnamed"), so a live codex tab
 * reports `01a00ee9-f0e9-7503-a11c-83b4eface0f6` where claude reports a
 * sentence. Rove must not render that as a name — and the id is exactly what
 * names the tab instead (the rollout it points at holds the first prompt).
 */
const CODEX_THREAD_TITLE = "01a00ee9-f0e9-7503-a11c-83b4eface0f6"

describe("engine placeholder titles", () => {
  it("reads codex's thread id back out of its own title", () => {
    expect(engineSessionIdFromTitle("codex", CODEX_THREAD_TITLE)).toBe(CODEX_THREAD_TITLE)
    expect(isEnginePlaceholderTitle(CODEX_THREAD_TITLE, "codex")).toBe(true)
  })

  it("a NAMED codex thread is a name, not a placeholder", () => {
    expect(engineSessionIdFromTitle("codex", "fix the flaky watcher test")).toBeNull()
    expect(isEnginePlaceholderTitle("fix the flaky watcher test", "codex")).toBe(false)
    // A title that merely CONTAINS a uuid is still a name (anchored match).
    expect(isEnginePlaceholderTitle(`resume ${CODEX_THREAD_TITLE}`, "codex")).toBe(false)
  })
})
