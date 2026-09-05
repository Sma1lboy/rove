import { describe, expect, it } from "vitest"
import { mergeWorktreeSyncHook } from "../../src/engine/claude-code-local/hook-adapter.ts"
import { hasKobeActivityHooks, mergeActivityHooks, removeWorktreeWatchHook } from "../../src/engine/json-hooks.ts"
import { quoteShellArgv } from "../../src/lib/shell-command.ts"

const events = [{ event: "Stop", verb: "turn-complete" }] as const
const settings = (event: string, command: string) => ({
  hooks: { [event]: [{ matcher: "*", extra: true, hooks: [{ type: "command", command }] }] },
})

const invocations = [
  ["kobe"],
  ["rove"],
  ["/usr/local/bin/rove"],
  ["/path with spaces/it's/bin/kobe"],
  ["bun", "--conditions=browser", new URL("../../src/cli/rove.ts", import.meta.url).pathname],
  ["/opt/homebrew/bin/bun", "--conditions=browser", "/old checkout/packages/kobe/src/cli/kobe.ts"],
  ["node", "/old checkout/packages/kobe/dist/cli/rove.js"],
  ["/usr/local/bin/node", "/old checkout/packages/kobe/dist/cli/kobe.js"],
]

describe("Rove hook command ownership", () => {
  it.each([
    "echo 'hook turn-complete'",
    "rove\nhook turn-complete",
    "\u00a0rove hook turn-complete",
    "rove hook turn-complete\n",
    "audit-wrapper hook turn-complete",
    "echo rove hook turn-complete",
    "rove hook turn-complete; echo user",
    "rove hook turn-complete && echo user",
    "rove hook turn-complete | audit-wrapper",
    "rove hook turn-complete > /tmp/user-file",
    "env CUSTOM=1 rove hook turn-complete",
    "sh -c 'rove hook turn-complete'",
    "node /user/rove.js hook turn-complete",
    "rove hook turn-complete-extra",
    "rove hook turn-complete --custom-option",
  ])("keeps unconfirmed user commands: %s", (command) => {
    const current = settings("Stop", command)
    expect(hasKobeActivityHooks(current, events)).toBe(false)
    expect(mergeActivityHooks(current, false, events, ["kobe"])).toEqual(current)
    const installed = mergeActivityHooks(current, true, events, ["kobe"])
    expect(mergeActivityHooks(installed, false, events, ["kobe"])).toEqual(current)
  })

  it.each(["echo worktree-created", "audit-wrapper hook worktree-created", "kobe hook worktree-created && echo user"])(
    "keeps user legacy lookalikes: %s",
    (command) => {
      const watch = settings("PostToolUse", command)
      const sync = settings("WorktreeCreate", command)
      expect(removeWorktreeWatchHook(watch)).toEqual(watch)
      expect(mergeWorktreeSyncHook(sync, null)).toEqual(sync)
    },
  )

  it.each(invocations.map((inv) => [inv.join(" "), inv] as const))(
    "recognizes generated invocation %s",
    (_name, inv) => {
      for (const suffix of [[], ["--engine", "claude"]]) {
        const activity = settings("Stop", quoteShellArgv([...inv, "hook", "turn-complete", ...suffix]))
        expect(hasKobeActivityHooks(activity, events)).toBe(true)
        expect(mergeActivityHooks(activity, false, events, ["kobe"])).toEqual({})
        const command = quoteShellArgv([...inv, "hook", "worktree-created"])
        expect(removeWorktreeWatchHook(settings("PostToolUse", command))).toEqual({})
        expect(mergeWorktreeSyncHook(settings("WorktreeCreate", command), null)).toEqual({})
      }
    },
  )

  it.each([
    "kobe hook turn-complete",
    " \trove\t hook \tturn-complete \t",
    quoteShellArgv(["/path\nwith spaces/rove", "hook", "turn-complete"]),
    "/usr/local/bin/rove hook turn-complete --engine codex",
    '"/path with spaces/rove" "hook" "turn-complete"',
    "bun --conditions=browser /repo/packages/kobe/src/cli/kobe.ts hook turn-complete",
    "node /repo/packages/kobe/dist/cli/rove.js hook turn-complete",
  ])("recognizes historical literal invocation %s", (command) => {
    const current = settings("Stop", command)
    expect(hasKobeActivityHooks(current, events)).toBe(true)
    expect(mergeActivityHooks(current, false, events, ["kobe"])).toEqual({})
  })
})
