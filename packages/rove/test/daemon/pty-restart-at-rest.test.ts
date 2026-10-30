import type { PtyDriver } from "@sma1lboy/rove-daemon/daemon/pty-driver"
import { PtyHost } from "@sma1lboy/rove-daemon/daemon/pty-host"
import { expect, it } from "vitest"

const key = "task::tab-1"
const spec = { cwd: "/tmp", command: ["/bin/cat"] }
function fixture() {
  let output: (data: string) => void = () => {}
  const driver: PtyDriver = ({ onData }) => {
    output = onData
    let end: (exit: { code: number; signal: null }) => void = () => {}
    return {
      pid: 1,
      exited: new Promise((resolve) => {
        end = resolve
      }),
      write() {},
      resize() {},
      close() {},
      kill() {
        end({ code: 0, signal: null })
      },
    }
  }
  const host = new PtyHost({ driver })
  const open = () => host.open(key, spec, {}, () => {})
  open()
  const status = (state: string) => output(`\x1b]7501;state=${state}\x07`)
  const snapshot = () => {
    const row = host.list()[0]
    if (!row?.generation || !row.programStatusEvent) throw new Error("missing status")
    return { generation: row.generation, revision: row.programStatusEvent.revision }
  }
  return { host, open, status, snapshot }
}

it.each(["working", "blocked", "error", "clear"])("refuses a status change to %s after inspection", async (state) => {
  const f = fixture()
  f.status("idle")
  const before = f.snapshot()
  f.status(state)
  expect((await f.host.killAtRest(key, before.generation, before.revision)).accepted).toBe(false)
  expect(f.host.list()[0]?.alive).toBe(true)
  await f.host.kill(key)
})

it("refuses input after idle until fresh at-rest evidence arrives", async () => {
  const f = fixture()
  f.status("idle")
  const before = f.snapshot()
  f.host.write(key, "new turn\r")
  expect((await f.host.killAtRest(key, before.generation, before.revision)).accepted).toBe(false)
  f.status("done")
  expect((await f.host.killAtRest(key, before.generation, f.snapshot().revision)).accepted).toBe(true)
})

it("only one overlapping restart can remove a generation, and neither can remove its replacement", async () => {
  const f = fixture()
  f.status("idle")
  const before = f.snapshot()
  // Both issued before either settles: removal is synchronous, so the second sees no session.
  const first = f.host.killAtRest(key, before.generation, before.revision)
  const second = f.host.killAtRest(key, before.generation, before.revision)
  expect((await first).accepted).toBe(true)
  expect((await second).accepted).toBe(false)
  f.open()
  f.status("idle")
  expect((await f.host.killAtRest(key, before.generation, before.revision)).accepted).toBe(false)
  expect(f.host.list()[0]?.alive).toBe(true)
  await f.host.kill(key)
})
