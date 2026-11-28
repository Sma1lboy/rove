/**
 * The catalogs are SINGLE-SOURCED in src/contract.ts; the daemon imports
 * them from the SDK's `./contract` subpath. This test asserts the daemon's
 * re-exports are the very same objects — it fails if anyone re-forks a
 * local copy host-side, which is how silent drift would sneak back in.
 */
// Workspace devDependency on purpose: this test runs only in-repo.
import { CHANNEL_NAMES } from "@sma1lboy/rove-daemon/daemon/channels"
import { PLUGIN_EVENT_NAMES as HOST_EVENT_NAMES } from "@sma1lboy/rove-daemon/plugins/manifest"
import { DAEMON_CHANNELS, PLUGIN_EVENT_NAMES } from "@sma1lboy/rove-plugin-sdk/contract"
import { describe, expect, it } from "vitest"

describe("SDK ↔ host contract (single source)", () => {
  it("the daemon re-exports the SDK's event catalog object itself", () => {
    expect(HOST_EVENT_NAMES).toBe(PLUGIN_EVENT_NAMES)
  })

  it("the daemon's runtime channel list is the SDK's channel catalog object itself", () => {
    expect(CHANNEL_NAMES).toBe(DAEMON_CHANNELS)
  })
})
