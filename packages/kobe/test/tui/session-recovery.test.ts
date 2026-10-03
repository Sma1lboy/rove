import { describe, expect, it } from "vitest"
import { sessionRecovery } from "../../src/tui/panes/terminal/session-recovery"

describe("terminal recovery evidence", () => {
  it("identifies detach/reattach to a live child without claiming a new conversation", () => {
    expect(sessionRecovery({ alive: true, created: false, pid: 42, replay: "" })).toBe("live")
  })
  it("distinguishes a new child after host restart from retained screen contents", () => {
    expect(sessionRecovery({ alive: true, created: false, respawned: true, pid: 43, replay: "old" })).toBe("relaunched")
  })
  it("never treats historical screen contents as a running process", () => {
    expect(sessionRecovery({ alive: false, pid: null, replay: "old" })).toBe("restored")
  })
  it("does not infer recovery from fresh launches or old hosts lacking evidence", () => {
    expect(sessionRecovery({ alive: true, created: true, replay: "" })).toBeNull()
    expect(sessionRecovery({ alive: true, replay: "old" })).toBeNull()
    expect(sessionRecovery({ alive: false, replay: "" })).toBeNull()
  })
})
