import { expect, test } from "bun:test"
import { versionToAsk } from "../src/update-prompt.tsx"

test("a new version asks once per page load; a skipped one stays quiet until a newer one", () => {
  const base = { notify: true, skipped: null, asked: null }
  expect(versionToAsk({ ...base, latest: "0.9.283" })).toBe("0.9.283")
  expect(versionToAsk({ ...base, latest: null })).toBeNull()
  // Not now: already asked since the page loaded.
  expect(versionToAsk({ ...base, latest: "0.9.283", asked: "0.9.283" })).toBeNull()
  // Skip this version, then the next release.
  expect(versionToAsk({ ...base, latest: "0.9.283", skipped: "0.9.283" })).toBeNull()
  expect(versionToAsk({ ...base, latest: "0.9.284", skipped: "0.9.283" })).toBe("0.9.284")
  // Settings' update.notify off.
  expect(versionToAsk({ ...base, latest: "0.9.283", notify: false })).toBeNull()
})
