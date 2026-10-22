import { describe, expect, it } from "bun:test"
import { type EngineHealthFacts, engineHealth, engineLogin } from "../../src/engine/engine-health"

const ready: EngineHealthFacts = { binaryFound: true, login: "yes", hooks: "installed", commandChosen: false }
const key = (facts: Partial<EngineHealthFacts>) =>
  engineHealth({ ...ready, ...facts })
    .key.split(".")
    .pop()

describe("engineHealth", () => {
  it("reads Ready when nothing is wrong, including an engine with no hooks or no sign-in detector", () => {
    expect(key({})).toBe("ready")
    expect(key({ hooks: "unsupported", login: "unknown" })).toBe("ready")
  })

  it("names the first thing to fix, in the order a person would fix it", () => {
    expect(key({ binaryFound: undefined })).toBe("checking")
    expect(key({ binaryFound: null })).toBe("unknown")
    expect(key({ binaryFound: false, login: "no", hooks: "outdated" })).toBe("notInstalled")
    expect(key({ binaryFound: false, commandChosen: true })).toBe("notOnPath")
    expect(key({ configIssue: "bad json", login: "no" })).toBe("integrationBlocked")
    expect(key({ login: "no", hooks: "outdated" })).toBe("signIn")
    expect(key({ hooks: "outdated" })).toBe("integrationOutdated")
    expect(key({ hooks: "not-installed" })).toBe("integrationMissing")
  })

  it("keeps an absent engine grey rather than a warning", () => {
    expect(engineHealth({ ...ready, binaryFound: false }).tone).toBe("absent")
  })
})

describe("engineLogin", () => {
  it("never reads a missing or failed detector as signed out", () => {
    expect(engineLogin(null)).toBe("unknown")
    expect(engineLogin({ account: null })).toBe("unknown")
    expect(engineLogin({ account: { kind: "oauth" }, accountError: "boom" })).toBe("unknown")
    expect(engineLogin({ account: { kind: "none" } })).toBe("no")
    expect(engineLogin({ account: { kind: "apikey" } })).toBe("yes")
  })
})
