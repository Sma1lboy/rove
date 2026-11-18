import { expect, test } from "bun:test"
import { pagePorts } from "../src/ops/panel.ts"
import { T, fakeApi } from "./task-ops-harness.ts"

const row = (port: number, pid: number) => ({
  port,
  pid,
  command: "node",
  host: "127.0.0.1",
  url: `http://localhost:${port}`,
})

test("only the listeners that serve a page are offered, each port once, and each is asked once", async () => {
  const { api } = fakeApi({ ports: { ports: [row(5173, 1), row(5173, 2), row(51157, 3), row(3000, 4), row(9000, 5)] } })
  const asked: number[] = []
  const probe = async (l: { port: number }) => {
    asked.push(l.port)
    // 51157: an engine's own port (answers, not HTML). 9000: a server still starting (no answer).
    return l.port === 9000 ? undefined : l.port !== 51157
  }
  const seen = new Map<string, boolean>()
  const pages = [
    { port: 3000, url: "http://localhost:3000", command: "node" },
    { port: 5173, url: "http://localhost:5173", command: "node" },
  ]
  expect(await pagePorts(api, T, probe, seen)).toEqual(pages)
  asked.length = 0
  expect(await pagePorts(api, T, probe, seen)).toEqual(pages)
  expect(asked).toEqual([9000])
})

test("a task on another machine offers nothing: its listeners cannot be asked from here", async () => {
  const { api, calls } = fakeApi({ ports: { ports: [row(5173, 1)] } })
  expect(await pagePorts({ ...api, machineOf: () => "deck" }, T, async () => true, new Map())).toEqual([])
  expect(calls).toEqual([])
})
