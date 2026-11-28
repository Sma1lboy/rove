import { afterEach, expect, test } from "bun:test"

afterEach(() => Reflect.deleteProperty(globalThis, "__roveRelay"))

// The relay page's CSP allows `blob:` scripts but not `'self'`, and its origin serves only the loader.
test("through the relay, a bridge script loads over the tunnel as a blob: URL", async () => {
  const asked: string[] = []
  Reflect.set(globalThis, "__roveRelay", {
    fetch: async (path: string) => {
      asked.push(path)
      return new Response("registerProcessor('x', class {})")
    },
  })
  // A fresh instance: the module reads `__roveRelay` once, when it loads.
  const fresh = "../src/relay-transport.ts?relay"
  const { bridgeScriptUrl }: typeof import("../src/relay-transport.ts") = await import(fresh)
  const url = await bridgeScriptUrl("/dictation-worklet.js")
  expect(asked).toEqual(["/dictation-worklet.js"])
  expect(url.startsWith("blob:")).toBe(true)
  expect(await (await fetch(url)).text()).toBe("registerProcessor('x', class {})")
})
