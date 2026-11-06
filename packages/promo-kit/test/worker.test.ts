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
