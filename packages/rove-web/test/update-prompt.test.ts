import { expect, test } from "bun:test"
import { ASK_GAP_MS, versionToAsk } from "../src/update-prompt.tsx"

test("a new version asks at most once every five hours; a skipped one stays quiet until a newer one", () => {
  const now = 1_000_000_000
  const base = { notify: true, skipped: null, askedAt: null, now }
  expect(versionToAsk({ ...base, latest: "0.9.283" })).toBe("0.9.283")
  expect(versionToAsk({ ...base, latest: null })).toBeNull()
  // Asked a moment ago: quiet, even about a newer release and across a reload.
  expect(versionToAsk({ ...base, latest: "0.9.284", askedAt: now - 60_000 })).toBeNull()
  expect(versionToAsk({ ...base, latest: "0.9.284", askedAt: now - ASK_GAP_MS })).toBe("0.9.284")
  // Skip this version, then the next release.
  expect(versionToAsk({ ...base, latest: "0.9.283", skipped: "0.9.283" })).toBeNull()
  expect(versionToAsk({ ...base, latest: "0.9.284", skipped: "0.9.283" })).toBe("0.9.284")
  // Settings' update.notify off.
  expect(versionToAsk({ ...base, latest: "0.9.283", notify: false })).toBeNull()
})
