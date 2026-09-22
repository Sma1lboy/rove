/**
 * The tier PICKER (`engine/auto-routing-classifier.ts`).
 *
 * Two halves carry the weight here and neither is the happy path:
 *
 *   - **nothing declines into a throw.** Every way this can go wrong — off,
 *     no key, a 500, a timeout, an answer that is rubbish — has to come back
 *     as "no pick", because the caller is on the path that creates a task and
 *     a picker is not allowed to fail one.
 *   - **nothing is sent somewhere it should not go.** A credential named for
 *     one mode must not travel to the other, and a prompt must not leave over
 *     cleartext http to a host on the network.
 *
 * No network: `fetch` is injected. No ambient environment either — `env` is
 * passed in every case, so a machine with a real `TYPESAFE_API_KEY` exported
 * does not change what these assert.
 */

import { describe, expect, it } from "vitest"
import {
  type ClassifierConfig,
  JEV_ENDPOINT,
  PROMPT_LIMIT,
  classifyTier,
  jevRequest,
  readClassifierConfig,
} from "../../src/engine/auto-routing-classifier.ts"
import { DEFAULT_TIER_RUBRIC } from "../../src/engine/tier-rubric.generated.ts"

const from = (state: Record<string, unknown>) => (key: string) => state[key]

const config = (over: Partial<ClassifierConfig> = {}): ClassifierConfig => ({
  mode: { kind: "jev" },
  threshold: 0.5,
  timeoutMs: 1000,
  model: "jev-latest",
  keyEnv: "TYPESAFE_API_KEY",
  ...over,
})

const env = { TYPESAFE_API_KEY: "apikey_test" } as NodeJS.ProcessEnv

/** A `fetch` that answers once with `body`, and records what it was asked. */
function stubFetch(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const calls: { url: string; init: RequestInit }[] = []
  const fn = (async (url: string | URL | Request, reqInit: RequestInit = {}) => {
    calls.push({ url: String(url), init: reqInit })
    return {
      ok: (init.status ?? 200) < 400,
      status: init.status ?? 200,
      headers: new Headers(init.headers ?? {}),
      json: async () => body,
    } as Response
  }) as unknown as typeof globalThis.fetch
  return { fn, calls }
}

const choiceAnswer = (over: Record<string, unknown> = {}) => ({
  model: "jev-1.13.0",
  answers: {
    verdict: {
      type: "choice",
      choice: "deep",
      confidence: 0.71,
      probabilities: { swift: 0.05, standard: 0.2, deep: 0.75 },
      ...over,
    },
  },
})

const headersOf = (call: { init: RequestInit } | undefined) => (call?.init.headers ?? {}) as Record<string, string>

describe("readClassifierConfig", () => {
  it("is off when nothing is persisted — the setting has to be asked for", () => {
    expect(readClassifierConfig(from({})).mode).toEqual({ kind: "off" })
  })

  it("reads jev and an https endpoint", () => {
    expect(readClassifierConfig(from({ "autoRouting.classifier": "jev" })).mode).toEqual({ kind: "jev" })
    expect(readClassifierConfig(from({ "autoRouting.classifier": "https://tiers.internal/pick" })).mode).toEqual({
      kind: "url",
      url: "https://tiers.internal/pick",
    })
  })

  it("reads anything unrecognizable as off — a typo must not become 'send it somewhere'", () => {
    for (const raw of ["Jev", "jevv", "on", "true", "tiers.internal/pick", "ftp://x/y", ""]) {
      expect(readClassifierConfig(from({ "autoRouting.classifier": raw })).mode).toEqual({ kind: "off" })
    }
  })

  it("takes http:// for a loopback host and refuses it for anything else", () => {
    // Loopback http is the escape hatch the custom option exists for: run the
    // classifier yourself and the prompt never leaves the machine.
    for (const url of ["http://127.0.0.1:8000/tier", "http://localhost:8000/tier", "http://[::1]:8000/tier"]) {
      expect(readClassifierConfig(from({ "autoRouting.classifier": url })).mode).toMatchObject({ kind: "url", url })
    }
    // Over a network the same URL carries the prompt, and the token, in
    // cleartext. Refused rather than read as `off`, because someone who typed
    // an address deserves to be told why nothing is happening.
    const refused = readClassifierConfig(from({ "autoRouting.classifier": "http://tiers.internal/pick" })).mode
    expect(refused.kind).toBe("refused")
    expect(refused.kind === "refused" && refused.why).toMatch(/https:\/\/ for tiers\.internal/)
  })

  it("gives each mode its OWN key variable, so a mode switch cannot move a credential", () => {
    expect(readClassifierConfig(from({ "autoRouting.classifier": "jev" })).keyEnv).toBe("TYPESAFE_API_KEY")
    expect(
      readClassifierConfig(from({ "autoRouting.classifier": "jev", "autoRouting.classifierKeyEnv": "TS_PROD" })).keyEnv,
    ).toBe("TS_PROD")
    // A custom endpoint does NOT inherit jev's name — that inheritance is
    // exactly what would carry a credential across a switch.
    const custom = { "autoRouting.classifier": "https://t.internal/p", "autoRouting.classifierKeyEnv": "TS_PROD" }
    expect(readClassifierConfig(from(custom)).keyEnv).toBeUndefined()
    expect(readClassifierConfig(from({ ...custom, "autoRouting.classifierCustomKeyEnv": "MINE" })).keyEnv).toBe("MINE")
  })

  it("takes a threshold stored as a number or a numeric string", () => {
    expect(readClassifierConfig(from({ "autoRouting.classifierThreshold": 0.9 })).threshold).toBe(0.9)
    expect(readClassifierConfig(from({ "autoRouting.classifierThreshold": "0.8" })).threshold).toBe(0.8)
  })

  it("REFUSES an out-of-range threshold instead of clamping it", () => {
    // `50` is someone writing a percentage. Clamping it to 1.0 leaves the
    // classifier switched on, paying for a request per create, and never
    // picking anything — silently. Falling back to the shipped default is the
    // better guess at what they meant, and it still works.
    expect(readClassifierConfig(from({ "autoRouting.classifierThreshold": 50 })).threshold).toBe(0.5)
    expect(readClassifierConfig(from({ "autoRouting.classifierThreshold": -2 })).threshold).toBe(0.5)
    expect(readClassifierConfig(from({ "autoRouting.classifierTimeoutMs": 10 })).timeoutMs).toBe(4000)
    expect(readClassifierConfig(from({ "autoRouting.classifierTimeoutMs": 900_000 })).timeoutMs).toBe(4000)
  })

  it("reads junk and a BLANK threshold as unset, not as a floor of zero", () => {
    // `Number("")` is 0. A hand-edited empty value in the file the docs invite
    // people to edit would otherwise accept every answer however unsure —
    // the one rule this module exists to keep, undone by a stray keystroke.
    for (const blank of ["", "   ", "soon"]) {
      expect(readClassifierConfig(from({ "autoRouting.classifierThreshold": blank })).threshold).toBe(0.5)
    }
  })
})

describe("classifyTier — every failure is a decline", () => {
  it("sends nothing at all while the classifier is off", async () => {
    const { fn, calls } = stubFetch(choiceAnswer())
    const out = await classifyTier("anything", config({ mode: { kind: "off" } }), { fetch: fn, env })
    expect(out).toEqual({ kind: "declined", reason: "off" })
    expect(calls).toHaveLength(0)
  })

  it("sends nothing to a refused endpoint, and says why", async () => {
    const { fn, calls } = stubFetch({ tier: "swift", confidence: 0.9 })
    const out = await classifyTier("x", config({ mode: { kind: "refused", why: "use https://" } }), { fetch: fn, env })
    expect(out).toEqual({ kind: "declined", reason: "refused", detail: "use https://" })
    expect(calls).toHaveLength(0)
  })

  it("declines blank text without a request", async () => {
    const { fn, calls } = stubFetch(choiceAnswer())
    expect(await classifyTier("   \n ", config(), { fetch: fn, env })).toMatchObject({ reason: "blank" })
    expect(calls).toHaveLength(0)
  })

  it("declines when no key is set, rather than calling unauthenticated", async () => {
    const { fn, calls } = stubFetch(choiceAnswer())
    const out = await classifyTier("fix the flaky test", config(), { fetch: fn, env: {} })
    expect(out).toMatchObject({ kind: "declined", reason: "no-key" })
    expect(calls).toHaveLength(0)
  })

  it("declines a non-2xx, a thrown fetch, and an answer that fails validation", async () => {
    const { fn: http500 } = stubFetch({}, { status: 500 })
    expect(await classifyTier("x", config(), { fetch: http500, env })).toMatchObject({
      reason: "failed",
      detail: "HTTP 500",
    })
    const thrower = (async () => {
      throw new Error("ECONNREFUSED")
    }) as unknown as typeof globalThis.fetch
    expect(await classifyTier("x", config(), { fetch: thrower, env })).toMatchObject({ reason: "failed" })

    const { fn: garbage } = stubFetch({ answers: { verdict: { choice: "urgent" } } })
    expect(await classifyTier("x", config(), { fetch: garbage, env })).toMatchObject({ reason: "failed" })
  })

  it("names a 429 as the shared pool rather than your quota, and reports retry-after without sleeping", async () => {
    // The interface doc's own warning: a run of blank tiers after a 429 must
    // not send someone off to buy credit they already have.
    const { fn } = stubFetch({}, { status: 429, headers: { "retry-after": "12" } })
    const started = Date.now()
    const out = await classifyTier("x", config(), { fetch: fn, env })
    expect(out).toMatchObject({ reason: "failed" })
    expect(out.kind === "declined" && out.detail).toMatch(/pool rate limit, not necessarily your quota, retry-after 12/)
    // Reported, not honoured — a create is not held for twelve seconds.
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it("declines — and aborts — when the endpoint outlasts the timeout", async () => {
    let aborted = false
    const slow = ((_url: string, init: RequestInit = {}) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          aborted = true
          const err = new Error("aborted")
          err.name = "AbortError"
          reject(err)
        })
      })) as unknown as typeof globalThis.fetch
    const out = await classifyTier("x", config({ timeoutMs: 200 }), { fetch: slow, env })
    expect(out).toMatchObject({ reason: "failed" })
    expect(aborted).toBe(true)
  })

  it("declines an answer below the threshold — a wrong pre-fill costs more than none", async () => {
    const { fn } = stubFetch(choiceAnswer({ confidence: 0.44 }))
    expect(await classifyTier("x", config({ threshold: 0.5 }), { fetch: fn, env })).toMatchObject({
      kind: "declined",
      reason: "low-confidence",
    })
    const { fn: same } = stubFetch(choiceAnswer({ confidence: 0.44 }))
    expect(await classifyTier("x", config({ threshold: 0.4 }), { fetch: same, env })).toMatchObject({ kind: "picked" })
  })
})

describe("classifyTier — the request", () => {
  it("posts to the jev endpoint with the bearer token and the rubric's examples", async () => {
    const { fn, calls } = stubFetch(choiceAnswer())
    const out = await classifyTier("there's a memory leak somewhere", config(), { fetch: fn, env })
    expect(out).toEqual({
      kind: "picked",
      verdict: { tier: "deep", confidence: 0.71, probabilities: { swift: 0.05, standard: 0.2, deep: 0.75 } },
    })
    const call = calls[0]
    expect(call?.url).toBe(JEV_ENDPOINT)
    expect(headersOf(call).authorization).toBe("Bearer apikey_test")
    const body = JSON.parse(String(call?.init.body))
    expect(body.state.task_text).toBe("there's a memory leak somewhere")
    expect(body.state.labelled_examples).toHaveLength(DEFAULT_TIER_RUBRIC.examples.length)
    expect(Object.keys(body.questions.verdict.criteria).sort()).toEqual(["deep", "standard", "swift"])
  })

  it("trims the prompt to the limit — a tier is decided by the opening, not the tail", async () => {
    const { fn, calls } = stubFetch(choiceAnswer())
    await classifyTier("a".repeat(PROMPT_LIMIT + 500), config(), { fetch: fn, env })
    expect(JSON.parse(String(calls[0]?.init.body)).state.task_text).toHaveLength(PROMPT_LIMIT)
  })

  it("sends no Authorization header when this mode has no key variable", async () => {
    // A custom endpoint is a host that never asked for a credential — and a
    // key stored for the OTHER mode must not follow the user across.
    const { fn, calls } = stubFetch({ tier: "swift", confidence: 0.9 })
    await classifyTier("x", config({ mode: { kind: "url", url: "https://t.internal/p" }, keyEnv: undefined }), {
      fetch: fn,
      env: { TYPESAFE_API_KEY: "jevs-key" },
    })
    expect(headersOf(calls[0])).not.toHaveProperty("authorization")
  })

  it("sends the header once this mode names its own variable", async () => {
    const { fn, calls } = stubFetch({ tier: "swift", confidence: 0.9 })
    await classifyTier("x", config({ mode: { kind: "url", url: "https://t.internal/p" }, keyEnv: "MY_TIER_KEY" }), {
      fetch: fn,
      env: { MY_TIER_KEY: "mine", TYPESAFE_API_KEY: "jevs-key" },
    })
    expect(headersOf(calls[0]).authorization).toBe("Bearer mine")
  })

  it("posts a custom endpoint the one-line contract, and reads its two fields back", async () => {
    const { fn, calls } = stubFetch({ tier: "swift", confidence: 0.9 })
    const out = await classifyTier("rename the flag", config({ mode: { kind: "url", url: "https://t.internal/p" } }), {
      fetch: fn,
      env,
    })
    expect(out).toEqual({ kind: "picked", verdict: { tier: "swift", confidence: 0.9 } })
    expect(calls[0]?.url).toBe("https://t.internal/p")
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ text: "rename the flag" })
  })

  it("carries the measured question shape and nothing else", () => {
    const body = jevRequest("do the thing", "jev-latest", DEFAULT_TIER_RUBRIC)
    // No repo or topic context: every configuration that added it lost 5–9
    // points on the dev slice.
    expect(Object.keys(body.state as object).sort()).toEqual(["labelled_examples", "task_text"])
    const verdict = (body.questions as { verdict: Record<string, unknown> }).verdict
    expect(verdict.type).toBe("choice")
    // The boundary rules ride inside each option (+3.2 points), spelled the
    // way the measured request spelled them.
    expect(Object.keys((verdict.criteria as Record<string, object>).deep).sort()).toEqual(["what", "边界"])
  })
})
