import { describe, expect, test } from "bun:test"
import { generateKeyPairSync, sign } from "node:crypto"
import { type FetchJwks, createAccessVerifier } from "../src/cf-access.ts"

const TEAM = "https://acme.cloudflareaccess.com"
const AUD = "aud-tag-123"
const NOW = 1_800_000_000_000

const signer = generateKeyPairSync("rsa", { modulusLength: 2048 })
const stranger = generateKeyPairSync("rsa", { modulusLength: 2048 })
const jwks = { keys: [{ ...signer.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256" }] }

function jwt(claims: Record<string, unknown>, opts: { kid?: string; key?: typeof signer.privateKey } = {}): string {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url")
  const head = enc({ alg: "RS256", kid: opts.kid ?? "k1", typ: "JWT" })
  const body = enc(claims)
  const sig = sign("RSA-SHA256", Buffer.from(`${head}.${body}`), opts.key ?? signer.privateKey).toString("base64url")
  return `${head}.${body}.${sig}`
}

const valid = { iss: TEAM, aud: [AUD], exp: NOW / 1000 + 300, iat: NOW / 1000 - 10, sub: "svc" }

function verifier(fetchJwks: FetchJwks = async () => jwks) {
  return createAccessVerifier({ teamDomain: TEAM, aud: AUD }, { fetchJwks, now: () => NOW })
}

describe("Cloudflare Access JWT", () => {
  test("a JWT signed by the team key for this AUD is accepted, with keys fetched from the team certs URL", async () => {
    const urls: string[] = []
    const v = verifier(async (url) => {
      urls.push(url)
      return jwks
    })
    await v.verify(jwt(valid))
    await v.verify(jwt(valid))
    expect(urls).toEqual([`${TEAM}/cdn-cgi/access/certs`])
  })

  test("a missing header is refused", async () => {
    await expect(verifier().verify(null)).rejects.toThrow("missing Cf-Access-Jwt-Assertion")
  })

  test("an expired JWT is refused", async () => {
    await expect(verifier().verify(jwt({ ...valid, exp: NOW / 1000 - 3600 }))).rejects.toThrow("expired")
  })

  test("a JWT for another Access application (aud) is refused", async () => {
    await expect(verifier().verify(jwt({ ...valid, aud: ["someone-else"] }))).rejects.toThrow("audience")
  })

  test("a JWT from another team (iss) is refused", async () => {
    await expect(verifier().verify(jwt({ ...valid, iss: "https://evil.cloudflareaccess.com" }))).rejects.toThrow(
      "issuer",
    )
  })

  test("a JWT signed by a different key is refused, even under a known kid", async () => {
    await expect(verifier().verify(jwt(valid, { key: stranger.privateKey }))).rejects.toThrow("signature")
  })

  test("a tampered payload fails the signature", async () => {
    const [h, , s] = jwt(valid).split(".")
    const forged = Buffer.from(JSON.stringify({ ...valid, aud: [AUD], sub: "admin" })).toString("base64url")
    await expect(verifier().verify(`${h}.${forged}.${s}`)).rejects.toThrow("signature")
  })

  test("junk kids inside the refetch window are refused without refetching the certs", async () => {
    let fetches = 0
    const v = verifier(async () => {
      fetches++
      return jwks
    })
    await v.verify(jwt(valid))
    await expect(v.verify(jwt(valid, { kid: "rotated" }))).rejects.toThrow("no signing key")
    await expect(v.verify(jwt(valid, { kid: "rotated" }))).rejects.toThrow("no signing key")
    expect(fetches).toBe(1)
  })
})
