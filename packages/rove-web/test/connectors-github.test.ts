import { describe, expect, test } from "bun:test"
import { type GithubStatus, markOf } from "../src/connectors-github.ts"

const status = (over: Partial<GithubStatus>): GithubStatus => ({
  git: "2.50.1",
  gh: "2.92.0",
  account: "octo",
  protocol: "https",
  gitUsesGh: true,
  ssh: { ok: false },
  login: null,
  ...over,
})

describe("markOf", () => {
  test("a machine is compared by account to Rove's", () => {
    expect(markOf({ status: status({}) }, "online", "octo")).toBe("same")
    expect(markOf({ status: status({ account: "someone" }) }, "online", "octo")).toBe("different")
    expect(markOf({ status: status({ account: null }) }, "online", "octo")).toBe("signedOut")
    expect(markOf({ status: status({ gh: null, account: null }) }, "online", "octo")).toBe("noGh")
  })

  test("what the feed says about the machine wins over any probe, and an unanswered probe is its reason", () => {
    expect(markOf({ status: status({}) }, "offline", "octo")).toBe("offline")
    expect(markOf(undefined, "mismatch", "octo")).toBe("outdated")
    expect(markOf(undefined, "online", "octo")).toBe("loading")
    expect(markOf({ status: null, reason: "outdated" }, "online", "octo")).toBe("outdated")
    expect(markOf({ status: null, reason: "offline" }, "online", "octo")).toBe("offline")
  })
})
