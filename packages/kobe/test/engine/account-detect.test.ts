import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  type DetectDeps,
  detectAvailableVendors,
  detectClaudeAccount,
  detectCodexAccount,
  detectCopilotAccount,
  resetAvailableVendorsCache,
} from "../../src/engine/account-detect.ts"
import { detectBobAccount } from "../../src/engine/bob-local/account.ts"

/** A DetectDeps with every binary found and no files/env, overridable per test. */
function deps(over: Partial<DetectDeps> = {}): DetectDeps {
  return {
    readFile: () => null,
    env: () => undefined,
    home: () => "/home/u",
    findClaudeBinary: async () => "/bin/claude",
    findCodexBinary: async () => "/bin/codex",
    findCopilotBinary: async () => "/bin/copilot",
    findKimiBinary: async () => "/bin/kimi",
    findPiBinary: async () => "/bin/pi",
    findOmpBinary: async () => "/bin/omp",
    findBobBinary: async () => "/bin/bob",
    ...over,
  }
}

// A JWT (header.payload.signature) with a payload we control; signature unverified.
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url")
  return `${b64({ alg: "none" })}.${b64(payload)}.sig`
}

describe("detectClaudeAccount", () => {
  it("reports the oauth email + org from ~/.claude.json", async () => {
    const status = await detectClaudeAccount(
      deps({
        readFile: () => JSON.stringify({ oauthAccount: { emailAddress: "a@b.com", organizationName: "Acme" } }),
      }),
    )
    expect(status.binary).toEqual({ found: true, path: "/bin/claude" })
    expect(status.account).toEqual({
      kind: "oauth",
      email: "a@b.com",
      organization: "Acme",
      displayName: undefined,
      billingType: undefined,
    })
  })

  it("is 'none' when the config file is absent", async () => {
    const status = await detectClaudeAccount(deps())
    expect(status.account).toEqual({ kind: "none" })
  })

  it("surfaces a binary-not-found without throwing", async () => {
    const status = await detectClaudeAccount(
      deps({
        findClaudeBinary: async () => {
          throw new Error("nope")
        },
      }),
    )
    expect(status.binary.found).toBe(false)
  })
})

describe("detectCodexAccount", () => {
  it("decodes the ChatGPT id_token email + plan", async () => {
    const idToken = jwt({ email: "c@d.com", "https://api.openai.com/auth": { chatgpt_plan_type: "pro" } })
    const status = await detectCodexAccount(deps({ readFile: () => JSON.stringify({ tokens: { id_token: idToken } }) }))
    expect(status.account).toEqual({ kind: "chatgpt", email: "c@d.com", plan: "pro" })
  })

  it("falls back to api-key login", async () => {
    const status = await detectCodexAccount(deps({ readFile: () => JSON.stringify({ OPENAI_API_KEY: "sk-x" }) }))
    expect(status.account).toEqual({ kind: "apikey" })
  })
})

describe("detectAvailableVendors", () => {
  const notFound = async () => {
    throw new Error("not on PATH")
  }

  it("lists every vendor whose binary resolves, in cycle order", async () => {
    expect(await detectAvailableVendors(deps())).toEqual(["claude", "codex", "copilot", "kimi", "pi", "omp", "bob"])
  })

  it("excludes vendors whose binary is missing", async () => {
    const only = await detectAvailableVendors(
      deps({
        findClaudeBinary: notFound,
        findCopilotBinary: notFound,
        findKimiBinary: notFound,
        findPiBinary: notFound,
        findOmpBinary: notFound,
        findBobBinary: notFound,
      }),
    )
    expect(only).toEqual(["codex"])
  })

  it("returns [] when no engine CLI is found", async () => {
    const none = await detectAvailableVendors(
      deps({
        findClaudeBinary: notFound,
        findCodexBinary: notFound,
        findCopilotBinary: notFound,
        findKimiBinary: notFound,
        findPiBinary: notFound,
        findOmpBinary: notFound,
        findBobBinary: notFound,
      }),
    )
    expect(none).toEqual([])
  })
})

/**
 * Memoization contract (perf): the built-in binary probe is three blocking
 * `spawnSync('which')` calls that re-ran on every engine-cycle keypress /
 * dialog-open / Ctrl+T for an effectively-constant value (installed CLIs don't
 * change mid-session). The default-deps path is now memoized per process; a
 * caller injecting custom deps must still re-probe so tests + an explicit
 * rescan stay honest. We assert the seam observably via cached PROMISE identity.
 */
describe("detectAvailableVendors caching", () => {
  afterEach(() => resetAvailableVendorsCache())

  it("memoizes the default-deps probe (same promise reference across calls)", () => {
    resetAvailableVendorsCache()
    const a = detectAvailableVendors()
    const b = detectAvailableVendors()
    expect(a).toBe(b) // cached promise shared → the `which` probe runs once
  })

  it("re-probes after resetAvailableVendorsCache()", () => {
    const a = detectAvailableVendors()
    resetAvailableVendorsCache()
    const b = detectAvailableVendors()
    expect(a).not.toBe(b) // cache cleared → a fresh probe promise
  })

  it("never caches custom-deps calls (each returns a fresh probe)", () => {
    const a = detectAvailableVendors(deps())
    const b = detectAvailableVendors(deps())
    expect(a).not.toBe(b) // custom deps bypass the memo entirely
  })
})

describe("detectCopilotAccount", () => {
  it("prefers an env token and names its source", async () => {
    const status = await detectCopilotAccount(deps({ env: (n) => (n === "GH_TOKEN" ? "ghp_x" : undefined) }))
    expect(status.account).toEqual({ kind: "token", source: "GH_TOKEN" })
  })

  it("detects an on-disk oauth login from config.json", async () => {
    const status = await detectCopilotAccount(deps({ readFile: () => JSON.stringify({ oauth_token: "tok" }) }))
    expect(status.account).toEqual({ kind: "oauth" })
  })

  it("is 'none' with no token and no config", async () => {
    expect((await detectCopilotAccount(deps())).account).toEqual({ kind: "none" })
  })
})

describe("detectBobAccount", () => {
  // Bob's token store is a flat map whose VALUES are the serialized token
  // records — the shape its bundle's secrets class persists (`Object.fromEntries`
  // of a Map, values written by `JSON.stringify`). Both a string value and an
  // already-parsed object are accepted so a future bob that stops
  // double-encoding still reads as logged in.
  const store = (value: unknown) => JSON.stringify({ user_session: value })

  it("reads a browser login from ~/.bob/settings/auth-secrets.json", async () => {
    const status = await detectBobAccount(
      deps({ readFile: () => store(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_at: 1 })) }),
    )
    expect(status.binary).toEqual({ found: true, path: "/bin/bob" })
    expect(status.account).toEqual({ kind: "oauth" })
  })

  it("accepts a token record stored as an object, in either key casing", async () => {
    expect((await detectBobAccount(deps({ readFile: () => store({ accessToken: "at" }) }))).account).toEqual({
      kind: "oauth",
    })
  })

  it("reads the file from the given home, never from an env override", async () => {
    const seen: string[] = []
    await detectBobAccount(
      deps({
        home: () => "/home/u",
        readFile: (p) => {
          seen.push(p)
          return null
        },
      }),
    )
    expect(seen).toEqual([path.join("/home/u", ".bob", "settings", "auth-secrets.json")])
  })

  it("reports an API key from BOB_API_KEY (or the legacy BOBSHELL_API_KEY) ahead of the store", async () => {
    const key = (name: string) => (n: string) => (n === name ? "k-123" : undefined)
    expect((await detectBobAccount(deps({ env: key("BOB_API_KEY") }))).account).toEqual({ kind: "apikey" })
    expect((await detectBobAccount(deps({ env: key("BOBSHELL_API_KEY") }))).account).toEqual({ kind: "apikey" })
    // A blank key is no key.
    expect((await detectBobAccount(deps({ env: () => "  " }))).account).toEqual({ kind: "none" })
  })

  it("is 'none' with no store, an empty store, or a store with no token", async () => {
    expect((await detectBobAccount(deps())).account).toEqual({ kind: "none" })
    expect((await detectBobAccount(deps({ readFile: () => "{}" }))).account).toEqual({ kind: "none" })
    expect((await detectBobAccount(deps({ readFile: () => store({ access_token: "" }) }))).account).toEqual({
      kind: "none",
    })
    expect((await detectBobAccount(deps({ readFile: () => store("not json") }))).account).toEqual({ kind: "none" })
  })

  it("surfaces a corrupt store as accountError, not as a throw", async () => {
    const status = await detectBobAccount(deps({ readFile: () => "{nope" }))
    expect(status.account).toEqual({ kind: "none" })
    expect(status.accountError).toMatch(/parse .*auth-secrets\.json/)
  })

  it("still reports the account when the binary is missing", async () => {
    const status = await detectBobAccount(
      deps({
        findBobBinary: async () => Promise.reject(new Error("nope")),
        env: (n) => (n === "BOB_API_KEY" ? "k" : undefined),
      }),
    )
    expect(status.binary.found).toBe(false)
    expect(status.account).toEqual({ kind: "apikey" })
  })
})
