import { expect, test } from "bun:test"
import { MachineStore, createMachineOps } from "../src/ops/machines.ts"
import { BridgeError } from "../src/protocol.ts"
import { fakeApi } from "./task-ops-harness.ts"

test("machines.list reports each machine's state and why it is down, never the raw ssh error or a duplicate alias", async () => {
  const store = new MachineStore()
  store.set([
    { alias: "narwhal", hostLabel: "narwhal", state: "online", version: "0.9.246" },
    {
      alias: "otter",
      hostLabel: "otter",
      state: "offline",
      reason: "auth-denied",
      error: "me@10.0.0.7: Permission denied (publickey)",
    },
    { alias: "otter2", hostLabel: "otter2", state: "offline", duplicateOf: "otter" },
  ])
  const reply = await createMachineOps(store)["machines.list"]?.run({}, {} as never)
  expect(reply).toEqual({
    machines: [
      { alias: "narwhal", hostLabel: "narwhal", state: "online", version: "0.9.246", reason: null },
      { alias: "otter", hostLabel: "otter", state: "offline", version: null, reason: "auth-denied" },
    ],
  })
  expect(JSON.stringify(reply)).not.toContain("10.0.0.7")
})

const reposOf = (store: MachineStore, args: Record<string, unknown>, replies: Record<string, unknown>) => {
  const { api, calls } = fakeApi(replies)
  return createMachineOps(store)
    ["machines.repos"]?.run(args, { api })
    ?.then((result) => ({ result, calls }))
}

test("machines.repos lists the machine's repos by id, running repo-list there", async () => {
  const store = new MachineStore()
  store.set([{ alias: "narwhal", hostLabel: "narwhal", state: "online", version: "0.9.272" }])
  const out = await reposOf(
    store,
    { machine: "narwhal" },
    {
      "repo-list": {
        repos: [
          { id: "github.com/o/n", primary: "/home/me/n", checkouts: ["/home/me/n", "/tmp/n"] },
          { id: "root:abc", primary: null, checkouts: ["/home/me/x"] },
          { nope: true },
        ],
      },
    },
  )
  expect(out?.calls).toEqual([{ verb: "repo-list", argv: [], machine: "narwhal" }])
  expect(out?.result).toEqual({
    repos: [
      { id: "github.com/o/n", primary: "/home/me/n", checkouts: ["/home/me/n", "/tmp/n"] },
      { id: "root:abc", primary: null, checkouts: ["/home/me/x"] },
    ],
  })
})

test("machines.repos is a reason, never a throw, for a machine that cannot answer; a known-down one is not even tried", async () => {
  const store = new MachineStore()
  store.set([
    { alias: "up", hostLabel: "up", state: "online", version: "0.9.272" },
    { alias: "down", hostLabel: "down", state: "offline" },
    { alias: "old", hostLabel: "old", state: "mismatch", version: "0.9.100" },
  ])
  const refuse = (code: string) => () => {
    throw new BridgeError(code, `refused ${code}`)
  }
  expect((await reposOf(store, { machine: "up" }, { "repo-list": refuse("UNKNOWN_VERB") }))?.result).toEqual({
    repos: [],
    reason: "outdated",
    message: "refused UNKNOWN_VERB",
  })
  expect(
    (await reposOf(store, { machine: "up" }, { "repo-list": refuse("MACHINE_UNREACHABLE") }))?.result,
  ).toMatchObject({ repos: [], reason: "offline" })
  const down = await reposOf(store, { machine: "down" }, { "repo-list": { repos: [] } })
  expect(down?.calls).toEqual([])
  expect(down?.result).toMatchObject({ repos: [], reason: "offline" })
  expect((await reposOf(store, { machine: "old" }, {}))?.result).toMatchObject({ repos: [], reason: "outdated" })
})

test("machines.repos needs a registered machine to name", async () => {
  const store = new MachineStore()
  await expect(reposOf(store, {}, {})).rejects.toMatchObject({ code: "BAD_ARGS" })
  await expect(reposOf(store, { machine: "local" }, {})).rejects.toMatchObject({ code: "BAD_ARGS" })
})
