import { expect, test } from "bun:test"
import worker from "../worker.js"

const enc = (o: object | Uint8Array) =>
  Buffer.from(o instanceof Uint8Array ? o : JSON.stringify(o)).toString("base64url")

test("only a valid, unexpired Access JWT for our AUD gets through; no token is a 403", async () => {
  const { privateKey, publicKey } = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )
  const jwk = { ...(await crypto.subtle.exportKey("jwk", publicKey)), kid: "k1" }
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => Response.json({ keys: [jwk] })) as any
  const sign = async (body: object) => {
    const hp = `${enc({ alg: "RS256", kid: "k1" })}.${enc(body)}`
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(hp))
    return `${hp}.${enc(new Uint8Array(sig))}`
  }
  const env = {
    ACCESS_TEAM: "team",
    ACCESS_AUD: "aud1",
    UPLOAD_TOKEN: "w",
    ASSETS: { fetch: () => new Response("page") },
  }
  const hit = async (jwt?: string) =>
    (await worker.fetch(new Request("https://kit/", { headers: jwt ? { "cf-access-jwt-assertion": jwt } : {} }), env)).status
  const exp = Date.now() / 1000 + 60
  try {
    expect(await hit()).toBe(403)
    expect(await hit(await sign({ aud: ["aud1"], exp }))).toBe(200)
    expect(await hit(await sign({ aud: ["other"], exp }))).toBe(403)
    expect(await hit(await sign({ aud: ["aud1"], exp: exp - 120 }))).toBe(403)
    expect(await hit("a.b.c")).toBe(403)
    expect((await worker.fetch(new Request("https://kit/"), { ...env, ACCESS_AUD: "" })).status).toBe(403)
  } finally {
    globalThis.fetch = realFetch
  }
})
