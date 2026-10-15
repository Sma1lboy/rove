import { expect, test } from "bun:test"
import { MachineStore, createMachineOps } from "../src/ops/machines.ts"

test("machines.list reports each machine's state, and a version only once a handshake gave one", async () => {
  const store = new MachineStore()
  store.set([
    { alias: "narwhal", hostLabel: "narwhal", state: "online", version: "0.9.246" },
    { alias: "otter", hostLabel: "otter", state: "offline" },
  ])
  expect(await createMachineOps(store)["machines.list"]?.run({}, {} as never)).toEqual({
    machines: [
      { alias: "narwhal", hostLabel: "narwhal", state: "online", version: "0.9.246" },
      { alias: "otter", hostLabel: "otter", state: "offline", version: null },
    ],
  })
})
