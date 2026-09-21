/**
 * The tier PICKER (`engine/auto-effort-classifier.ts`).
 *
 * Two halves carry the weight here and neither is about the happy path:
 *
 *   - **nothing declines into a throw.** Every way this can go wrong — off,
 *     no key, a 500, a timeout, an answer that is rubbish — has to come back
 *     as "no pick", because the caller is on the path that creates a task and
 *     a picker is not allowed to fail one.
 *   - **the answer is not believed until it is checked.** A well-typed
 *     response carrying an out-of-enum tier, a lying argmax, or probabilities
 *     that do not sum is exactly what validation exists for.
 *
 * No network: `fetch` is injected.
 */

import { describe, expect, it } from "vitest"
import {
  type ClassifierConfig,
  JEV_ENDPOINT,
  PROMPT_LIMIT,
  classifyTier,
  jevRequest,
  readChoiceAnswer,
  readClassifierConfig,
  readPlainAnswer,
} from "../../src/engine/auto-effort-classifier.ts"
import { DEFAULT_TIER_RUBRIC } from "../../src/engine/auto-effort-rubric.ts"

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
function stubFetch(body: unknown, init: { status?: number } = {}) {
  const calls: { url: string; init: RequestInit }[] = []
  const fn = (async (url: string | URL | Request, reqInit: RequestInit = {}) => {
    calls.push({ url: String(url), init: reqInit })
    return {
      ok: (init.status ?? 200) < 400,
      status: init.status ?? 200,
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

describe("readClassifierConfig", () => {
  it("is off when nothing is persisted — the setting has to be asked for", () => {
    expect(readClassifierConfig(from({})).mode).toEqual({ kind: "off" })
  })

  it("reads jev and an http(s) endpoint", () => {
    expect(readClassifierConfig(from({ "autoEffort.classifier": "jev" })).mode).toEqual({ kind: "jev" })
    expect(readClassifierConfig(from({ "autoEffort.classifier": "https://tiers.internal/pick" })).mode).toEqual({
      kind: "url",
      url: "https://tiers.internal/pick",
    })
  })

  it("reads anything else as off — a typo must not become 'send it somewhere'", () => {
    for (const raw of ["Jev", "jevv", "on", "true", "tiers.internal/pick", "ftp://x/y", ""]) {
      expect(readClassifierConfig(from({ "autoEffort.classifier": raw })).mode).toEqual({ kind: "off" })
    }
  })

  it("clamps the threshold into [0,1] and keeps the defaults for junk", () => {
    expect(readClassifierConfig(from({ "autoEffort.classifierThreshold": "0.8" })).threshold).toBe(0.8)
    expect(readClassifierConfig(from({ "autoEffort.classifierThreshold": 4 })).threshold).toBe(1)
    expect(readClassifierConfig(from({ "autoEffort.classifierThreshold": -2 })).threshold).toBe(0)
    expect(readClassifierConfig(from({ "autoEffort.classifierThreshold": "soon" })).threshold).toBe(0.5)
  })
})

describe("classifyTier — every failure is a decline", () => {
  it("sends nothing at all while the classifier is off", async () => {
    const { fn, calls } = stubFetch(choiceAnswer())
    const out = await classifyTier("anything", config({ mode: { kind: "off" } }), { fetch: fn, env })
    expect(out).toEqual({ kind: "declined", reason: "off" })
    expect(calls).toHaveLength(0)
  })

  it("declines blank text without a request", async () => {
    const { fn, calls } = stubFetch(choiceAnswer())
    expect(await classifyTier("   \n ", config(), { fetch: fn, env })).toMatchObject({ reason: "blank" })
    expect(calls).toHaveLength(0)
  })

  it("declines when the key's env var is unset, rather than calling unauthenticated", async () => {
    const { fn, calls } = stubFetch(choiceAnswer())
    const out = await classifyTier("fix the flaky test", config(), { fetch: fn, env: {} })
    expect(out).toMatchObject({ kind: "declined", reason: "no-key" })
    expect(calls).toHaveLength(0)
  })

  it("declines a non-2xx, a thrown fetch, and an unparseable body", async () => {
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
    expect((call?.init.headers as Record<string, string>).authorization).toBe("Bearer apikey_test")
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

  it("does not carry repo or topic context — every configuration that added it lost points", () => {
    const body = jevRequest("do the thing", "jev-latest", DEFAULT_TIER_RUBRIC)
    expect(Object.keys(body.state as object).sort()).toEqual(["labelled_examples", "task_text"])
  })
})

describe("readChoiceAnswer", () => {
  const ok = { choice: "standard", confidence: 0.6, probabilities: { swift: 0.2, standard: 0.5, deep: 0.3 } }

  it("accepts a well-formed answer", () => {
    expect(readChoiceAnswer(ok)).toMatchObject({ ok: true })
  })

  it("refuses a choice outside the enum we offered — the one check that is about safety", () => {
    expect(readChoiceAnswer({ ...ok, choice: "urgent" })).toMatchObject({ ok: false })
    expect(readChoiceAnswer({ ...ok, choice: 2 })).toMatchObject({ ok: false })
  })

  it("refuses probability keys that are not exactly the enum", () => {
    expect(readChoiceAnswer({ ...ok, probabilities: { swift: 0.5, standard: 0.5 } })).toMatchObject({ ok: false })
    expect(
      readChoiceAnswer({ ...ok, probabilities: { swift: 0.2, standard: 0.5, deep: 0.2, urgent: 0.1 } }),
    ).toMatchObject({ ok: false })
  })

  it("refuses a number that is not a probability", () => {
    for (const bad of [Number.NaN, -0.1, 1.2, "0.5", null]) {
      expect(readChoiceAnswer({ ...ok, probabilities: { ...ok.probabilities, deep: bad } })).toMatchObject({
        ok: false,
      })
    }
  })

  it("refuses a choice that is not the argmax of its own distribution", () => {
    expect(readChoiceAnswer({ ...ok, choice: "swift" })).toMatchObject({ ok: false })
  })

  it("tolerates a sum of 0.99 / 1.01 and passes the numbers through UNSCALED", () => {
    const rounded = { choice: "deep", confidence: 0.5, probabilities: { swift: 0.33, standard: 0.33, deep: 0.34 } }
    const read = readChoiceAnswer(rounded)
    expect(read).toMatchObject({ ok: true })
    // Renormalizing would make this 0.3333…; every threshold after it would
    // then be judging our arithmetic rather than the model's answer.
    expect(read.ok && read.value.probabilities).toEqual(rounded.probabilities)
  })

  it("refuses a distribution that does not sum to 1 within tolerance", () => {
    expect(readChoiceAnswer({ ...ok, probabilities: { swift: 0.1, standard: 0.2, deep: 0.3 } })).toMatchObject({
      ok: false,
    })
  })

  it("refuses a missing or out-of-range confidence", () => {
    expect(readChoiceAnswer({ ...ok, confidence: undefined })).toMatchObject({ ok: false })
    expect(readChoiceAnswer({ ...ok, confidence: 1.4 })).toMatchObject({ ok: false })
  })
})

describe("readPlainAnswer", () => {
  it("takes a tier and a confidence, and reports no distribution it was not given", () => {
    const read = readPlainAnswer({ tier: "deep", confidence: 0.8 })
    expect(read).toEqual({ ok: true, value: { tier: "deep", confidence: 0.8 } })
  })

  it("refuses a tier outside the enum and a confidence that is not one", () => {
    expect(readPlainAnswer({ tier: "urgent", confidence: 0.8 })).toMatchObject({ ok: false })
    expect(readPlainAnswer({ tier: "deep", confidence: "high" })).toMatchObject({ ok: false })
    expect(readPlainAnswer("deep")).toMatchObject({ ok: false })
  })
})
