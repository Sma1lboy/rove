import { describe, expect, it } from "vitest"
import { mergeActivityHooks, roveHookArgs } from "../../src/engine/json-hooks.ts"

const events = [{ event: "SessionStart", verb: "session-start" }] as const
const group = (command: string) => ({ hooks: [{ type: "command", command }] })
const current = group("rove hook session-start --engine codex --hook-version 1")
const merge = (doc: Record<string, unknown>) =>
  mergeActivityHooks(doc, true, events, ["rove"], { extraArgs: roveHookArgs("codex") })

describe("legacy hook migration", () => {
  it("collapses duplicate Codex SessionStart groups and stays stable on the next launch", () => {
    const migrated = merge({
      hooks: {
        SessionStart: [
          group("kobe hook session-start --engine codex --hook-version 1"),
          group("kobe hook session-start --engine codex"),
          current,
        ],
      },
    })
    expect(migrated).toEqual({ hooks: { SessionStart: [current] } })
    expect(merge(migrated)).toEqual(migrated)
  })

  it("preserves user commands and group metadata alongside legacy hooks", () => {
    const userHooks = [
      { type: "command", command: "kobe hook session-start && echo user" },
      { type: "command", command: "kobe hook session-start --custom-option" },
      { type: "command", command: "node /user/kobe.js hook session-start" },
      { type: "command", command: "echo user", timeout: 10 },
    ]
    expect(
      merge({
        extra: true,
        hooks: {
          SessionStart: [{ matcher: "*", hooks: [...group("kobe hook session-start").hooks, ...userHooks] }],
        },
      }),
    ).toEqual({ extra: true, hooks: { SessionStart: [{ matcher: "*", hooks: userHooks }, current] } })
  })
})
