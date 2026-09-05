import { describe, expect, it } from "vitest"
import { mergeWorktreeSyncHook } from "../../src/engine/claude-code-local/hook-adapter.ts"
import { mergeActivityHooks, removeWorktreeWatchHook } from "../../src/engine/json-hooks.ts"

const user = { type: "command", command: "echo user", timeout: 73 }
const group = (command: string) => ({
  matcher: "Bash",
  userField: { keep: true },
  hooks: [{ type: "command", command }, user],
})
const kept = { matcher: "Bash", userField: { keep: true }, hooks: [user] }

describe("shared hook groups", () => {
  it("preserves user commands and group fields during activity install and removal", () => {
    const current = { extra: true, hooks: { Stop: [group("'kobe' 'hook' 'turn-complete'")] } }
    const events = [{ event: "Stop", verb: "turn-complete" }] as const
    const installed = mergeActivityHooks(current, true, events, ["kobe"])
    expect(installed).toMatchObject({
      extra: true,
      hooks: { Stop: [kept, { hooks: [{ command: "'kobe' 'hook' 'turn-complete'" }] }] },
    })
    expect(mergeActivityHooks(installed, false, events, ["kobe"])).toEqual({ extra: true, hooks: { Stop: [kept] } })
    expect(current.hooks.Stop[0].hooks).toHaveLength(2)
  })

  it.each([
    { event: "WorktreeCreate", remove: (doc: Record<string, unknown>) => mergeWorktreeSyncHook(doc, null) },
    { event: "PostToolUse", remove: removeWorktreeWatchHook },
  ])("removes only the retired command in $event", ({ event, remove }) => {
    const current = { extra: true, hooks: { [event]: [group("kobe hook worktree-created")] } }
    const result = remove(current)
    expect(result).toEqual({ extra: true, hooks: { [event]: [kept] } })
    expect(remove(result)).toEqual(result)
  })
})
