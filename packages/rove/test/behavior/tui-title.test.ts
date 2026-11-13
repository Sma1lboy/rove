/**
 * Regression pin: the pure-TUI host owns the outer terminal tab title while
 * it is running. Without an emitted OSC title, iTerm2 falls back to the
 * JavaScript runtime name (it shows up as "node").
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { type BehaviorEnv, DIST_ROVE_CLI, closeTui, loadNodePty, makeBehaviorEnv } from "./harness.ts"

// node-pty is a native addon; CI's linux runner has no prebuild for it, so a
// top-level import fails the whole suite before skip logic can run. The
// shared loader also verifies it can actually SPAWN here (a sandboxed shell
// can have the module and still be denied posix_spawnp) — see harness.ts.
const nodePty = await loadNodePty()

const TITLE_SEQUENCE = "\x1b]0;rove\x07"

describe.skipIf(!nodePty)("Rove outer terminal title (behavior)", () => {
  let env: BehaviorEnv

  beforeAll(async () => {
    env = await makeBehaviorEnv()
  })

  afterAll(async () => {
    await env.dispose()
  })

  it("publishes rove as the terminal title on pure-TUI boot", async () => {
    const child = nodePty!.spawn("bun", [DIST_ROVE_CLI], {
      cols: 120,
      rows: 35,
      cwd: env.home,
      env: env.env as Record<string, string>,
    })
    let raw = ""
    const data = child.onData((chunk) => {
      raw += chunk
    })
    try {
      await vi.waitFor(() => expect(raw).toContain(TITLE_SEQUENCE), { timeout: 10_000, interval: 50 })
    } finally {
      data.dispose()
      await closeTui(child)
    }
  }, 15_000)
})
