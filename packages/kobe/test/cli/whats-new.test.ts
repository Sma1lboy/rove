/**
 * The once-per-upgrade gate's pure decision. Wrong here is visible on every
 * launch: a false positive re-greets the user with the same notes forever,
 * a false negative means the feature never fires at all. The three "say
 * nothing" cases (fresh install, relaunch, downgrade) are the ones worth
 * pinning — they are what keeps the first screen from becoming a gate.
 */

import { describe, expect, test } from "vitest"
import { LAST_RUN_VERSION_KEY } from "../../src/cli/reset-gate.ts"
import { WHATS_NEW_SEEN_KEY, whatsNewFromVersion } from "../../src/cli/whats-new.ts"

describe("whatsNewFromVersion", () => {
  test("an upgrade reports the version it came from", () => {
    expect(whatsNewFromVersion({ [WHATS_NEW_SEEN_KEY]: "0.9.200" }, "0.9.205")).toBe("0.9.200")
  })

  test("a relaunch on the same build says nothing", () => {
    expect(whatsNewFromVersion({ [WHATS_NEW_SEEN_KEY]: "0.9.205" }, "0.9.205")).toBeNull()
  })

  test("a fresh install says nothing — there is no older build to have changed from", () => {
    expect(whatsNewFromVersion({}, "0.9.205")).toBeNull()
  })

  test("a downgrade says nothing — the release range would run backwards", () => {
    expect(whatsNewFromVersion({ [WHATS_NEW_SEEN_KEY]: "0.9.210" }, "0.9.205")).toBeNull()
  })

  test("an install predating the key falls back to the reset gate's stamp", () => {
    expect(whatsNewFromVersion({ [LAST_RUN_VERSION_KEY]: "0.9.100" }, "0.9.205")).toBe("0.9.100")
  })

  test("the What's New stamp wins over the reset gate's, which every launch rewrites", () => {
    expect(
      whatsNewFromVersion({ [WHATS_NEW_SEEN_KEY]: "0.9.205", [LAST_RUN_VERSION_KEY]: "0.9.100" }, "0.9.205"),
    ).toBeNull()
  })

  test("a non-string stamp is treated as absent rather than crashing the boot path", () => {
    expect(whatsNewFromVersion({ [WHATS_NEW_SEEN_KEY]: 42 }, "0.9.205")).toBeNull()
  })
})
