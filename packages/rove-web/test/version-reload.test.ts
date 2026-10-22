import { expect, test } from "bun:test"
import type { BridgeClient, ConnView } from "../src/bridge.ts"
import { createStore } from "../src/store.ts"
import { versionAction, watchBridgeVersion } from "../src/version-reload.ts"

test("the first hello names the version the page was served with", () => {
  expect(versionAction(null, "0.9.264", null)).toBe("adopt")
})

test("a reconnect to the same version stays; a new version reloads once", () => {
  expect(versionAction("0.9.264", "0.9.264", null)).toBe("stay")
  expect(versionAction("0.9.264", "0.9.265", null)).toBe("reload")
  // Already reloaded for 0.9.265 and still served the old bundle: no loop.
  expect(versionAction("0.9.264", "0.9.265", "0.9.265")).toBe("stay")
  // A later upgrade reloads again.
  expect(versionAction("0.9.264", "0.9.266", "0.9.265")).toBe("reload")
})

function fakeClient() {
  const conn = createStore<ConnView>({ state: "connecting", hello: null, failures: 0 })
  const hello = (roveVersion: string) =>
    conn.set({ state: "open", hello: { protocol: 1, roveVersion, host: "h" }, failures: 0 })
  const drop = () => conn.set({ state: "retrying", hello: conn.get().hello, failures: 1 })
  return { client: { conn } as unknown as BridgeClient, hello, drop }
}

function memoryStorage() {
  const items = new Map<string, string>()
  return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v) }
}

test("the page reloads once when the bridge it reconnects to reports another version", () => {
  const { client, hello, drop } = fakeClient()
  const storage = memoryStorage()
  let reloads = 0
  watchBridgeVersion(client, { storage, reload: () => reloads++ })
  hello("0.9.264")
  drop()
  hello("0.9.264")
  expect(reloads).toBe(0)
  drop()
  hello("0.9.265")
  expect(reloads).toBe(1)
  // The reload did not happen (or landed on the old bundle again): never twice for one version.
  drop()
  hello("0.9.265")
  expect(reloads).toBe(1)
})

test("after the reload the new page adopts the new version and stays", () => {
  const storage = memoryStorage()
  storage.setItem("rove-web.reloadedFor", "0.9.265")
  const { client, hello, drop } = fakeClient()
  let reloads = 0
  watchBridgeVersion(client, { storage, reload: () => reloads++ })
  hello("0.9.265")
  drop()
  hello("0.9.265")
  expect(reloads).toBe(0)
})

test("blocked storage still reloads at most once per version", () => {
  const { client, hello, drop } = fakeClient()
  let reloads = 0
  watchBridgeVersion(client, { storage: null, reload: () => reloads++ })
  hello("1")
  drop()
  hello("2")
  drop()
  hello("2")
  expect(reloads).toBe(1)
})
