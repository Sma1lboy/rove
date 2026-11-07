import { afterAll, beforeAll, expect, test } from "bun:test"
import worker from "../worker.js"

const enc = (o: object | Uint8Array) =>
  Buffer.from(o instanceof Uint8Array ? o : JSON.stringify(o)).toString("base64url")

const { privateKey, publicKey } = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
)
const jwk = { ...(await crypto.subtle.exportKey("jwk", publicKey)), kid: "k1" }
const sign = async (body: object) => {
  const hp = `${enc({ alg: "RS256", kid: "k1" })}.${enc(body)}`
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(hp))
  return `${hp}.${enc(new Uint8Array(sig))}`
}
const exp = Date.now() / 1000 + 60

const realFetch = globalThis.fetch
beforeAll(() => {
  globalThis.fetch = (async () => Response.json({ keys: [jwk] })) as any
})
afterAll(() => {
  globalThis.fetch = realFetch
})

const memBucket = () => {
  const m = new Map<string, string>()
  return {
    get: async (k: string) => (m.has(k) ? { json: async () => JSON.parse(m.get(k)!) } : null),
    put: async (k: string, v: string) => void m.set(k, v),
    delete: async (k: string) => void m.delete(k),
  }
}
const baseEnv = () => ({
  ACCESS_TEAM: "team",
  ACCESS_AUD: "aud1",
  UPLOAD_TOKEN: "w",
  ASSETS: { fetch: () => new Response("page") },
  BUCKET: memBucket(),
})

test("only a valid, unexpired Access JWT for our AUD gets through; no token is a 403", async () => {
  const env = baseEnv()
  const hit = async (jwt?: string) =>
    (await worker.fetch(new Request("https://kit/", { headers: jwt ? { "cf-access-jwt-assertion": jwt } : {} }), env)).status
  expect(await hit()).toBe(403)
  expect(await hit(await sign({ aud: ["aud1"], exp }))).toBe(200)
  expect(await hit(await sign({ aud: ["other"], exp }))).toBe(403)
  expect(await hit(await sign({ aud: ["aud1"], exp: exp - 120 }))).toBe(403)
  expect(await hit("a.b.c")).toBe(403)
  expect((await worker.fetch(new Request("https://kit/"), { ...env, ACCESS_AUD: "" })).status).toBe(403)
})

test("a logged-in member mints an upload token; minting again revokes the old one", async () => {
  const env = baseEnv()
  const cookie = `CF_Authorization=${await sign({ aud: ["aud1"], exp, email: "a@x.com" })}`
  const mint = (headers: Record<string, string>) =>
    worker.fetch(new Request("https://kit/api/token", { method: "POST", headers }), env)
  const items = async (t: string) =>
    (await worker.fetch(new Request("https://kit/api/items", { headers: { authorization: `Bearer ${t}` } }), env)).status

  const t1 = (await (await mint({ cookie })).json()).token
  expect(await items(t1)).toBe(200)
  expect(await items("pk_forged")).toBe(403)

  const t2 = (await (await mint({ cookie })).json()).token
  expect(await items(t1)).toBe(403)
  expect(await items(t2)).toBe(200)

  expect((await mint({ authorization: `Bearer ${t2}` })).status).toBe(403)
  expect((await mint({ cookie, "sec-fetch-site": "cross-site" })).status).toBe(403)
})

test("members save copy versions and log sends; the list shows who sent it", async () => {
  const env = baseEnv()
  await env.BUCKET.put("index.json", JSON.stringify({ items: [{ id: "a", title: "A", posts: ["v1"], updated: "t0" }] }))
  const as = async (email: string) => ({ cookie: `CF_Authorization=${await sign({ aud: ["aud1"], exp, email })}` })
  const call = async (path: string, headers: Record<string, string>, body?: object) =>
    worker.fetch(
      new Request(`https://kit${path}`, { method: body ? "POST" : "GET", headers, body: body && JSON.stringify(body) }),
      env,
    )
  const ann = await as("ann@x.com")
  const bob = await as("bob@x.com")

  const saved = await (await call("/api/items/a/versions", ann, { posts: ["v2", "reply"] })).json()
  expect(saved.versions.map((v: { by: string }) => v.by)).toEqual(["上传", "ann@x.com"])
  // Saving identical copy adds no version.
  expect((await (await call("/api/items/a/versions", bob, { posts: ["v2", "reply"] })).json()).versions).toHaveLength(2)

  expect((await call("/api/items/a/events", bob, { action: "send" })).status).toBe(200)
  expect((await call("/api/items/a/events", bob, { action: "post-for-me" })).status).toBe(400)

  const list = await (await call("/api/items", ann)).json()
  expect(list.me).toBe("ann@x.com")
  expect(list.items[0].posts).toEqual(["v2", "reply"])
  expect(list.items[0].sends.map((e: { by: string }) => e.by)).toEqual(["bob@x.com"])

  expect((await call("/api/items/a/versions", {}, { posts: ["x"] })).status).toBe(403)
  expect((await call("/api/items/a/events", { ...bob, "sec-fetch-site": "cross-site" }, { action: "send" })).status).toBe(403)
})

test("an item keeps its created stamp across re-pushes; older items get it from their first version", async () => {
  const env = baseEnv()
  const writer = { authorization: "Bearer w", "content-type": "application/json" }
  await env.BUCKET.put("index.json", JSON.stringify({ items: [{ id: "old", title: "O", posts: ["p"], updated: "2026-11-06T00:00:00.000Z" }] }))
  await env.BUCKET.put("meta:versions/old", JSON.stringify([{ posts: ["p"], by: "上传", at: "2026-11-01T00:00:00.000Z" }]))
  const put = (body: object) =>
    worker.fetch(new Request("https://kit/api/items/new", { method: "PUT", headers: writer, body: JSON.stringify(body) }), env)
  const item = { title: "N", video: { key: "new/a.mp4", size: 1 }, posts: ["x"] }

  const first = await (await put(item)).json()
  expect(first.created).toBe(first.updated)
  // A client-sent `created` is ignored, and a re-push only moves `updated`.
  const again = await (await put({ ...item, created: "1999-01-01T00:00:00.000Z", posts: ["y"] })).json()
  expect(again.created).toBe(first.created)
  expect(again.updated >= first.updated).toBe(true)

  const list = await (await worker.fetch(new Request("https://kit/api/items", { headers: writer }), env)).json()
  expect(Object.fromEntries(list.items.map((it: { id: string; created: string }) => [it.id, it.created]))).toEqual({
    new: first.created,
    old: "2026-11-01T00:00:00.000Z",
  })
})
