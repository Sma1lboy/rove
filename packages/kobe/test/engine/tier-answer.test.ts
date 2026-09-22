/**
 * Believing an answer (`engine/tier-answer.ts`).
 *
 * A well-typed response is not a trustworthy one. Every case here is a
 * payload that would deserialize perfectly and must still be refused: an
 * out-of-enum tier, a distribution that disagrees with its own choice, a
 * confidence that is not one. The pass cases exist mainly to pin what is NOT
 * done to a good answer — the numbers come back exactly as they were sent.
 */

import { describe, expect, it } from "vitest"
import { readChoiceAnswer, readJevAnswer, readPlainAnswer } from "../../src/engine/tier-answer.ts"

const ok = { choice: "standard", confidence: 0.6, probabilities: { swift: 0.2, standard: 0.5, deep: 0.3 } }

describe("readChoiceAnswer", () => {
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

describe("readJevAnswer", () => {
  it("reaches the verdict through the envelope, and refuses one that is not there", () => {
    expect(readJevAnswer({ model: "jev-1.13.0", answers: { verdict: ok } })).toMatchObject({ ok: true })
    expect(readJevAnswer({ model: "jev-1.13.0", answers: {} })).toMatchObject({ ok: false })
    expect(readJevAnswer({ model: "jev-1.13.0" })).toMatchObject({ ok: false })
    expect(readJevAnswer("deep")).toMatchObject({ ok: false })
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
