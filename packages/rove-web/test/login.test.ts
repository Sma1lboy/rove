import { beforeAll, describe, expect, test } from "bun:test"

// `auth.ts` reads the address bar at import; give it a page with no `#token=`.
const items = new Map<string, string>()
beforeAll(() => {
  Object.assign(globalThis, {
    window: { location: { hash: "", pathname: "/", search: "" } },
    history: { replaceState: () => {} },
    localStorage: {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
      removeItem: (k: string) => void items.delete(k),
    },
  })
})
const load = () => import("../src/login.ts")
const TOKEN = "k".repeat(43)

const reply =
  (status: number, body: unknown, type = "application/json") =>
  async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": type },
    })

describe("login screen state", () => {
  test("each bridge answer maps to what the screen says", async () => {
    const { loginOutcome } = await load()
    expect(loginOutcome(200, { token: TOKEN, device: "web-login-x" })).toEqual({ kind: "ok", token: TOKEN })
    expect(loginOutcome(401, { error: "login failed" })).toEqual({ kind: "wrong" })
    expect(loginOutcome(429, { locked: "ip", retryAfterSeconds: 61 })).toEqual({ kind: "locked", minutes: 2 })
    expect(loginOutcome(429, { locked: "global" })).toEqual({ kind: "lockedHost" })
    expect(loginOutcome(200, { token: "short" })).toEqual({ kind: "unreachable" })
    expect(loginOutcome(502, null)).toEqual({ kind: "unreachable" })
  })

  test("a right password stores the token where a #token= link goes; a wrong one stores nothing", async () => {
    const { submitPassword } = await load()
    const { storedToken } = await import("../src/auth.ts")
    expect((await submitPassword("x", reply(401, { error: "login failed" }))).kind).toBe("wrong")
    expect(storedToken()).toBeNull()
    expect(await submitPassword("x", reply(200, { token: TOKEN }))).toEqual({ kind: "ok", token: TOKEN })
    expect(storedToken()).toBe(TOKEN)
  })

  test("the login screen shows only when the bridge answers /login with JSON", async () => {
    const { passwordLoginOn } = await load()
    expect(await passwordLoginOn(reply(200, { password: true }))).toBe(true)
    // No password set: /login is the app shell.
    expect(await passwordLoginOn(reply(200, "<!doctype html>", "text/html"))).toBe(false)
    expect(await passwordLoginOn(async () => Promise.reject(new Error("offline")))).toBe(false)
  })

  test("sign out forgets the token and revokes it with the bridge", async () => {
    const { signOut } = await load()
    const { saveToken, storedToken } = await import("../src/auth.ts")
    saveToken(TOKEN)
    const sent: Array<{ url: string; auth: string | null }> = []
    await signOut(async (url, init) => {
      sent.push({ url, auth: new Headers(init?.headers).get("authorization") })
      return new Response(null, { status: 204 })
    })
    expect(storedToken()).toBeNull()
    expect(sent).toEqual([{ url: "/logout", auth: `Bearer ${TOKEN}` }])
  })
})
