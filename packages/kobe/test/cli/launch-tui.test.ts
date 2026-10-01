import { beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ start: vi.fn(), apply: vi.fn() }))
vi.mock("../../src/tui/index.tsx", () => ({ startTui: mocks.start }))
vi.mock("../../src/cli/onboarding.ts", () => ({ runPendingWelcomeInstalls: mocks.apply }))
import { launchTui, trackWelcomeWrite } from "../../src/cli/launch-tui.ts"
beforeEach(() => {
  vi.clearAllMocks()
  trackWelcomeWrite(Promise.resolve())
})
it("waits for renderer release and accepted-choice persistence before installing", async () => {
  const order: string[] = []
  let release!: () => void
  mocks.start.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      }),
  )
  mocks.apply.mockImplementation(() => order.push("install"))
  const run = launchTui()
  await vi.waitFor(() => expect(release).toBeDefined())
  let save!: () => void
  trackWelcomeWrite(
    new Promise<void>((resolve) => {
      save = resolve
    }),
  )
  expect(mocks.apply).not.toHaveBeenCalled()
  release()
  await Promise.resolve()
  expect(mocks.apply).not.toHaveBeenCalled()
  order.push("saved")
  save()
  await run
  expect(order).toEqual(["saved", "install"])
  expect(mocks.apply).toHaveBeenCalledTimes(1)
})
it("does not run terminal installers if the TUI fails to start", async () => {
  mocks.start.mockRejectedValue(new Error("renderer failed"))
  await expect(launchTui()).rejects.toThrow("renderer failed")
  expect(mocks.apply).not.toHaveBeenCalled()
})
