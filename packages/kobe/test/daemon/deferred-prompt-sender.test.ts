import { deferredPromptSender } from "@sma1lboy/kobe-daemon/daemon/deferred-prompt-sender"
import { describe, expect, it } from "vitest"

/**
 * The header `cli/api/dispatcher.ts` stamps on a peer send is the ONLY place a
 * sender's identity travels with the prompt, and the Inbox episode never sees
 * the body. If this parser stops matching, every held message goes back to
 * being anonymous — which is the state that made dismissing one a coin flip.
 */
describe("deferred prompt sender", () => {
  it("lifts the task title out of a peer provenance header", () => {
    const prompt = '[ROVE PEER] from "Auth attempt" (task 01ABC — load the Rove agent skill FIRST)\n\nfix the login bug'
    expect(deferredPromptSender(prompt)).toBe("Auth attempt")
  })

  it("still reads the pre-rename [KOBE PEER] spelling", () => {
    expect(deferredPromptSender('[KOBE PEER] from "kobe" (task 01ABC)\n\nhi')).toBe("kobe")
  })

  it("names nobody rather than guessing", () => {
    // `--verbatim` sends, human pastes, and anything else with no header.
    expect(deferredPromptSender("just a prompt")).toBeUndefined()
    expect(deferredPromptSender('mid-text [ROVE PEER] from "spoof"')).toBeUndefined()
    expect(deferredPromptSender('[ROVE PEER] from ""')).toBeUndefined()
    expect(deferredPromptSender("")).toBeUndefined()
  })
})
