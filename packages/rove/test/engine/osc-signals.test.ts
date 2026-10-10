import { describe, expect, it } from "vitest"
import {
  applyProgramStatus,
  clearTransientStatuses,
  createOscSignals,
  scanOscSignals,
  statusActivity,
} from "../../../rove-daemon/src/daemon/osc-signals"

describe("OSC signals", () => {
  it("accepts every byte split, BEL and ST, and maps blocked to permission activity", () => {
    for (const end of ["\x07", "\x1b\\"]) {
      const raw = `\x1b]7501;state=blocked:kind=permission:msg=QXBwcm92ZT8=${end}`
      for (let split = 0; split <= raw.length; split++) {
        const state = createOscSignals()
        scanOscSignals(state, Buffer.from(raw.slice(0, split)), 1)
        scanOscSignals(state, Buffer.from(raw.slice(split)), 1)
        const status = state.records.get("")
        expect(status?.msg).toBe("Approve?")
        if (!status) throw new Error("missing")
        expect(statusActivity(status)).toMatchObject({ kind: "awaiting-input", detail: { waiting: "permission" } })
      }
    }
  })
  it("ignores invalid reports and clears descendants without touching siblings", () => {
    const s = createOscSignals()
    applyProgramStatus(s, "state=working:id=build", 1)
    applyProgramStatus(s, "state=done:id=build/test", 2)
    applyProgramStatus(s, "state=error:id=other", 3)
    applyProgramStatus(s, "state=clear:id=build", 4)
    expect([...s.records.keys()]).toEqual(["other"])
    for (const body of ["state=working:msg=AA==", "state=working:msg=A", "state=nope", "state=working:id=//bad"])
      applyProgramStatus(s, body, 5)
    expect(s.records.has("")).toBe(false)
    applyProgramStatus(s, "state=working", 6)
    clearTransientStatuses(s)
    expect([...s.records.keys()]).toEqual(["other"])
  })
  it("handles queries, RIS, context return/end, and bounds unfinished signals", () => {
    const s = createOscSignals()
    expect(scanOscSignals(s, Buffer.from("\x1b]7501;?\x07"))).toBe(1)
    scanOscSignals(
      s,
      Buffer.from("\x1b]3008;start=root;type=shell\x1b\\\x1b]3008;start=child;name=hello\\x3bworld\x07"),
    )
    expect(s.contexts[1]?.metadata.name).toBe("hello;world")
    scanOscSignals(s, Buffer.from("\x1b]3008;start=root;type=container\x07"))
    expect(s.contexts).toEqual([{ id: "root", metadata: { type: "container" } }])
    scanOscSignals(s, Buffer.from("\x1b]3008;end=root\x07"))
    expect(s.contexts).toHaveLength(0)
    applyProgramStatus(s, "state=done", 1)
    scanOscSignals(s, Buffer.from("\x1bc"))
    expect(s.records.size).toBe(0)
    scanOscSignals(s, Buffer.from(`\x1b]7501;${"a".repeat(10000)}`))
    expect(s.carry).toBe("")
  })
})

it("process exit drops transient status while preserving completion", async () => {
  const { PtyChildController } = await import("../../../rove-daemon/src/daemon/pty-child-controller")
  const { freshSessionState } = await import("../../../rove-daemon/src/daemon/pty-host-types")
  const session = freshSessionState("task::tab-1", { cwd: "/fixture", cols: 80, rows: 24 }, ["sh"])
  session.alive = true
  session.oscSignals = createOscSignals()
  applyProgramStatus(session.oscSignals, "state=working", 1)
  applyProgramStatus(session.oscSignals, "state=done:id=child", 2)
  new PtyChildController({ scrollbackCap: 1024 }).markExited(session, { code: 0, signal: null })
  expect([...session.oscSignals.records.keys()]).toEqual(["child"])
})

it("answers the program-status query before a DA1 support-detection sentinel", async () => {
  const { PtyChildController } = await import("../../../rove-daemon/src/daemon/pty-child-controller")
  let output: (data: string) => void = () => {}
  const writes: string[] = []
  const controller = new PtyChildController({
    scrollbackCap: 1024,
    driver: (request) => {
      output = request.onData
      return {
        pid: 1,
        exited: new Promise(() => {}),
        write: (data) => writes.push(data),
        resize() {},
        close() {},
        kill() {},
      }
    },
  })
  controller.spawn("task::tab-1", { cwd: "/fixture", command: ["fixture"] })
  output("\x1b]7501;?\x07\x1b[c")
  expect(writes.join("").startsWith("\x1b]7501;?\x1b\\")).toBe(true)
  expect(writes.join("")).toContain("\x1b[?")
})
