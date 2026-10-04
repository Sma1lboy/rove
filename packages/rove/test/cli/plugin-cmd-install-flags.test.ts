/**
 * `rove plugin install owner/repo --ref=X` must reach `installPlugin` with
 * `ref: "X"`. The old local `flagValue` did an exact-token `indexOf`, so the
 * attached form silently installed the default branch (#58 residual).
 * Sibling of plugin-cmd.test.ts, which drives the real link/list flow.
 */

import { describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ installPlugin: vi.fn() }))

vi.mock("../../src/cli/plugin-install.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/cli/plugin-install.ts")>()),
  installPlugin: mocks.installPlugin,
}))

import { runPluginSubcommand } from "../../src/cli/plugin-cmd.ts"

describe("plugin install flag parsing", () => {
  it("passes --ref in both the separated and attached form", async () => {
    mocks.installPlugin.mockResolvedValue("x")
    await runPluginSubcommand(["install", "owner/repo", "--ref", "v1.2"])
    await runPluginSubcommand(["install", "owner/repo", "--ref=v1.2", "--yes"])
    expect(mocks.installPlugin.mock.calls.map(([, opts]) => opts)).toEqual([
      { yes: false, ref: "v1.2" },
      { yes: true, ref: "v1.2" },
    ])
  })
})
