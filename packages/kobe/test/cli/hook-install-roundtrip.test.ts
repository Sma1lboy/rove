/**
 * The whole A-layer channel for copilot and droid, end to end, with nothing
 * about it hand-written: install into a throwaway config dir, read the command
 * string BACK OUT of the file the engine would read, split it into argv, and
 * feed that argv plus a hook payload to the real `runHookSubcommand`. What the
 * daemon receives is then the thing an actual session would have produced.
 *
 * This is what the per-adapter unit tests cannot catch: they assert the merge
 * writes a command, and the dispatcher tests assert a verb reports — between
 * them sits the question of whether the argv one wrote is the argv the other
 * accepts. A wrong `--engine` tag, a verb the dispatcher drops, or a quoting
 * change all look fine on both sides and break only here.
 *
 * Only the daemon socket is mocked (hooks are non-spawning by contract); the
 * engine adapters are the real ones.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  connectIfRunning: vi.fn(),
  request: vi.fn(),
  close: vi.fn(),
}))

vi.mock("@sma1lboy/kobe-daemon/client/daemon-process", () => ({
  connectIfRunning: mocks.connectIfRunning,
}))

import { runHookSubcommand } from "@/cli/hook-cmd"
import { CopilotHookAdapter } from "@/engine/copilot-local/hook-adapter"
import { DroidHookAdapter } from "@/engine/droid-local/hook-adapter"

/** Pull every `kobe hook …` command out of an installed config file, whatever
 *  container shape the engine uses, and return each as the argv
 *  `runHookSubcommand` is handed — everything after the `hook` word. */
function installedHookArgv(file: string): string[][] {
  const text = readFileSync(file, "utf8")
  return [...text.matchAll(/"command":\s*"([^"]+)"/g)].map((m) => {
    const words = (m[1] ?? "").split(" ")
    return words.slice(words.indexOf("hook") + 1)
  })
}

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "rove-hook-roundtrip-"))
  // The install's lock file belongs in a throwaway state dir, not the
  // developer's real ~/.rove.
  vi.stubEnv("ROVE_HOME_DIR", join(home, "rove"))
  // `kobeHookInvocation` probes PATH through a bare `Bun.which`, which does
  // not exist under vitest's node. Pinning it also fixes the command text the
  // assertions below read back.
  vi.stubGlobal("Bun", { which: () => "/usr/local/bin/kobe" })
  mocks.connectIfRunning.mockReset().mockResolvedValue({ request: mocks.request, close: mocks.close })
  mocks.request.mockReset().mockResolvedValue({})
  mocks.close.mockReset()
  // A run started from inside a Rove engine tab inherits these and the
  // dispatcher would report THAT tab instead of resolving the payload cwd —
  // green in CI, red only on a developer's machine.
  vi.stubEnv("KOBE_TASK_ID", undefined)
  vi.stubEnv("KOBE_TAB_ID", undefined)
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function stubStdin(payload: unknown): void {
  vi.stubGlobal("Bun", {
    which: () => "/usr/local/bin/kobe",
    stdin: { text: () => Promise.resolve(JSON.stringify(payload)) },
  })
}

/**
 * A copilot `SessionStart` payload in the shape GitHub's hooks reference
 * documents (docs.github.com/copilot/reference/hooks-reference): the event
 * name, the session id, and the workspace as `cwd`. NB: this is a SHAPE, not a
 * capture — copilot CLI was not installed on the machine this was written on,
 * so the field names come from the reference and from refs/herdr's copilot
 * hook, which reads `session_id` then `sessionId`.
 */
const COPILOT_SESSION_START = {
  hook_event_name: "SessionStart",
  session_id: "3d1b5f9a-0c4e-4a77-9a1f-8d2c6b0e5f11",
  cwd: "/repo/worktrees/otter",
} satisfies Record<string, unknown>

/** A droid `SessionStart` payload; same caveat, from refs/herdr's droid hook
 *  (`session_id`) plus the `cwd` every Claude-shaped hook payload carries. */
const DROID_SESSION_START = {
  hook_event_name: "SessionStart",
  session_id: "droid-7f3c",
  cwd: "/repo/worktrees/badger",
} satisfies Record<string, unknown>

describe("copilot: installed command → dispatcher → daemon", () => {
  it("reports session-start for the copilot task at the payload's cwd", async () => {
    const dir = join(home, ".copilot")
    mkdirSync(dir)
    const file = join(dir, "settings.json")
    await new CopilotHookAdapter().installActivityHooks(file, { quiet: true })

    const argvs = installedHookArgv(file)
    expect(argvs).toHaveLength(1)
    stubStdin(COPILOT_SESSION_START)
    await runHookSubcommand(argvs[0] as string[])

    expect(mocks.request).toHaveBeenCalledWith("engine.reportEvent", {
      cwd: "/repo/worktrees/otter",
      kind: "session-start",
      engine: "copilot",
      sessionId: COPILOT_SESSION_START.session_id,
    })
  })
})

describe("droid: installed command → dispatcher → daemon", () => {
  it("reports session-start for the droid task at the payload's cwd", async () => {
    const dir = join(home, ".factory")
    mkdirSync(dir)
    const file = join(dir, "settings.json")
    await new DroidHookAdapter().installActivityHooks(file, { quiet: true })

    const argvs = installedHookArgv(file)
    expect(argvs).toHaveLength(1)
    stubStdin(DROID_SESSION_START)
    await runHookSubcommand(argvs[0] as string[])

    expect(mocks.request).toHaveBeenCalledWith("engine.reportEvent", {
      cwd: "/repo/worktrees/badger",
      kind: "session-start",
      engine: "droid",
      sessionId: DROID_SESSION_START.session_id,
    })
  })

  // The `--engine <id>` tag is what picks the decoding adapter. Without it the
  // dispatcher asks every adapter in turn and takes the first answer, so a
  // droid session id could be attributed through copilot's reader — harmless
  // here (both read `session_id`) and not harmless the moment either engine
  // grows a detail decoder.
  it("tags the vendor so only that adapter decodes the payload", async () => {
    const dir = join(home, ".factory")
    mkdirSync(dir)
    const file = join(dir, "settings.json")
    await new DroidHookAdapter().installActivityHooks(file, { quiet: true })
    expect((installedHookArgv(file)[0] as string[]).join(" ")).toContain("--engine droid")
  })
})
