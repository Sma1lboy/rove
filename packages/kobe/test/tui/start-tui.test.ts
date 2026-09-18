import { beforeEach, describe, expect, it, vi } from "vitest"

const spies = vi.hoisted(() => ({
  enforceResetGate: vi.fn(),
  hintSkillInstall: vi.fn(),
  installHooks: vi.fn(async () => {}),
  publishTitle: vi.fn(),
  startWorkspaceHost: vi.fn(async () => {}),
  takeWhatsNew: vi.fn(() => null as string | null),
}))

vi.mock("../../src/cli/hook-cmd.ts", () => ({ ensureGlobalKobeHooks: spies.installHooks }))
// Spread the real module rather than listing the one function stubbed here:
// a factory that names only its stub turns every later export of the real
// module into a hard "No X export is defined on the mock" at import time.
vi.mock("../../src/cli/reset-gate.ts", async (importActual) => ({
  ...(await importActual<typeof import("../../src/cli/reset-gate.ts")>()),
  enforceResetGate: spies.enforceResetGate,
}))
vi.mock("../../src/cli/whats-new.ts", () => ({ takeWhatsNew: spies.takeWhatsNew }))
vi.mock("../../src/lib/skill-install.ts", () => ({ maybeHintSkillInstall: spies.hintSkillInstall }))
vi.mock("../../src/tui/lib/outer-terminal-title.ts", () => ({ publishKobeTerminalTitle: spies.publishTitle }))
vi.mock("../../src/tui-react/workspace/start-workspace", () => ({ startWorkspaceHost: spies.startWorkspaceHost }))

import { startTui } from "../../src/tui/index"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("startTui", () => {
  it("starts the sole Workspace Host", async () => {
    await startTui()

    expect(spies.startWorkspaceHost).toHaveBeenCalledOnce()
  })

  it("installs engine hooks before starting the Workspace Host", async () => {
    const order: string[] = []
    spies.installHooks.mockImplementationOnce(async () => {
      order.push("hooks")
    })
    spies.startWorkspaceHost.mockImplementationOnce(async () => {
      order.push("host")
    })

    await startTui()

    expect(spies.installHooks).toHaveBeenCalledOnce()
    expect(order).toEqual(["hooks", "host"])
  })

  /**
   * The What's New decision is read HERE and handed down, because the reset
   * gate rewrites the `app.lastRunVersion` stamp it falls back to. Reading it
   * after the gate is a silent downgrade to "nothing to show" on exactly the
   * upgrade that ships the key, so both the order and the handoff are pinned.
   */
  it("reads the What's New stamp before the reset gate and hands it to the host", async () => {
    const order: string[] = []
    spies.takeWhatsNew.mockImplementationOnce(() => {
      order.push("whats-new")
      return "0.9.100"
    })
    spies.enforceResetGate.mockImplementationOnce(() => {
      order.push("reset-gate")
    })

    await startTui()

    expect(order).toEqual(["whats-new", "reset-gate"])
    expect(spies.startWorkspaceHost).toHaveBeenCalledWith({ whatsNewFrom: "0.9.100" })
  })

  it("passes null through when there is nothing new to show", async () => {
    await startTui()

    expect(spies.startWorkspaceHost).toHaveBeenCalledWith({ whatsNewFrom: null })
  })
})
