/** CLI entry routing: public commands, sole TUI launch, and removed surfaces. */

import { type MockInstance, afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const spies = vi.hoisted(() => ({
  completions: vi.fn(async () => {}),
  exportCmd: vi.fn(async () => {}),
  repo: vi.fn(async () => {}),
  api: vi.fn(async () => {}),
  update: vi.fn(async () => {}),
  theme: vi.fn(async () => {}),
  feedback: vi.fn(async () => {}),
  daemon: vi.fn(async () => {}),
  doctor: vi.fn(async () => {}),
  reset: vi.fn(async () => {}),
  skill: vi.fn(async () => {}),
  hook: vi.fn(async () => {}),
  addRemote: vi.fn(async () => {}),
  openDirectory: vi.fn(async () => {}),
  startTui: vi.fn(async () => {}),
  pendingWelcomeInstalls: vi.fn(() => {}),
}))

vi.mock("../../src/cli/completions-cmd.ts", () => ({ runCompletionsSubcommand: spies.completions }))
vi.mock("../../src/cli/export-cmd.ts", () => ({ runExportSubcommand: spies.exportCmd }))
vi.mock("../../src/cli/repo-cmd.ts", () => ({ runRepoSubcommand: spies.repo }))
vi.mock("../../src/cli/api-cmd.ts", () => ({ runApiSubcommand: spies.api }))
vi.mock("../../src/cli/update.ts", () => ({ runUpdateSubcommand: spies.update }))
vi.mock("../../src/cli/theme.ts", () => ({ runThemeSubcommand: spies.theme }))
vi.mock("../../src/cli/feedback-cmd.ts", () => ({ runFeedbackSubcommand: spies.feedback }))
vi.mock("../../src/cli/daemon-cmd.ts", () => ({ runDaemonSubcommand: spies.daemon }))
vi.mock("../../src/cli/doctor-cmd.ts", () => ({ runDoctorSubcommand: spies.doctor }))
vi.mock("../../src/cli/reset-cmd.ts", () => ({ runResetSubcommand: spies.reset }))
vi.mock("../../src/cli/skill-cmd.ts", () => ({ runSkillSubcommand: spies.skill }))
vi.mock("../../src/cli/hook-cmd.ts", () => ({ runHookSubcommand: spies.hook }))
vi.mock("../../src/cli/add-remote.ts", () => ({ runAddRemote: spies.addRemote }))
vi.mock("../../src/cli/open-dir-cmd.ts", async (importOriginal) => ({
  // Real isPathLikeArg (the routing predicate under test), spied executor.
  ...(await importOriginal<typeof import("../../src/cli/open-dir-cmd.ts")>()),
  runOpenDirectory: spies.openDirectory,
}))
vi.mock("../../src/cli/onboarding.ts", () => ({ runPendingWelcomeInstalls: spies.pendingWelcomeInstalls }))
vi.mock("../../src/tui/index.tsx", () => ({ startTui: spies.startTui }))

let originalArgv: string[]
let exitSpy: ReturnType<typeof vi.fn>
let errorSpy: MockInstance

async function runCli(...args: string[]): Promise<void> {
  process.argv = ["bun", "/kobe/src/cli/index.ts", ...args]
  vi.resetModules()
  await import("../../src/cli/index.ts")
  // Bare launch performs sequential dynamic imports (terminal-title, the
  // TUI, then the deferred welcome installs). Drain enough turns for that
  // fire-and-forget main() chain to settle before assertions run.
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve))
}

beforeEach(() => {
  originalArgv = process.argv
  let exited = false
  exitSpy = vi.fn((code?: number) => {
    if (exited) return
    exited = true
    throw new Error(`process.exit(${code}) sentinel`)
  })
  vi.spyOn(process, "exit").mockImplementation(exitSpy as unknown as typeof process.exit)
  vi.spyOn(console, "log").mockImplementation(() => {})
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(process.stdout, "write").mockImplementation(() => true)
  vi.spyOn(process.stderr, "write").mockImplementation(() => true)
})

afterEach(() => {
  process.argv = originalArgv
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe("version, help, launch, and unknown commands", () => {
  /**
   * The regression this guards: a first run used to divert into a wizard that
   * ran INSTEAD of the TUI and exited, so `rove` had to be typed twice to
   * reach the product. The greeting is a dialog over the workspace now, so
   * every bare launch starts Rove — there is no branch that skips it.
   */
  test("a first run still launches the TUI — the greeting is a dialog, not a detour", async () => {
    await runCli()
    await vi.waitFor(() => expect(spies.startTui).toHaveBeenCalled())
  })

  /** npx and the summary lines need a terminal the renderer no longer owns. */
  test("deferred welcome installs run after the TUI exits", async () => {
    await runCli()
    await vi.waitFor(() => expect(spies.pendingWelcomeInstalls).toHaveBeenCalled())
    expect(spies.startTui.mock.invocationCallOrder[0]).toBeLessThan(
      spies.pendingWelcomeInstalls.mock.invocationCallOrder[0] as number,
    )
  })

  test.each(["--tmux", "--puretui", "reload", "kill-sessions"])(
    "retired surface %s is an unknown command",
    async (command) => {
      await runCli(command)
      expect(errorSpy).toHaveBeenCalledWith(`kobe: unknown command '${command}'`)
      expect(exitSpy).toHaveBeenCalledWith(2)
      expect(spies.startTui).not.toHaveBeenCalled()
    },
  )
})

describe("public subcommand routing", () => {
  test.each([".", "..", "./x", "/abs/path", "~/x"])("kobe %s routes to open-directory", async (arg) => {
    await runCli(arg)
    expect(spies.openDirectory).toHaveBeenCalledWith(arg)
    expect(exitSpy).not.toHaveBeenCalled()
  })

  test("a bare word is still an unknown command, not a directory guess", async () => {
    await runCli("statsu")
    expect(spies.openDirectory).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith("kobe: unknown command 'statsu'")
    expect(exitSpy).toHaveBeenCalledWith(2)
  })
})
