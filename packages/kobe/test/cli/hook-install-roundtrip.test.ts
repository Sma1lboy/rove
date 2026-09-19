/**
 * The whole A-layer channel for all four engines, end to end, with nothing
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
import { DevinHookAdapter } from "@/engine/devin-local/hook-adapter"
import { DroidHookAdapter } from "@/engine/droid-local/hook-adapter"
import type { EngineHookAdapter } from "@/engine/hook-adapter"
import { QodercliHookAdapter } from "@/engine/qodercli-local/hook-adapter"

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
 * The payloads below are SHAPES, not captures: none of the four CLIs was
 * installed on the machine this was written on. `hook_event_name` /
 * `session_id` / `cwd` come from GitHub's copilot hooks reference
 * (docs.github.com/copilot/reference/hooks-reference) and from refs/herdr's
 * own hook script for each engine, every one of which reads `session_id` and
 * exits when it is not a non-empty string.
 */
interface Roundtrip {
  readonly vendor: string
  readonly adapter: () => EngineHookAdapter
  /** Config path relative to a fake home, as segments. */
  readonly relPath: readonly string[]
  /** The session id the payload carries, and the cwd it names. */
  readonly sessionId: string
  readonly cwd: string
}

const ENGINES: readonly Roundtrip[] = [
  {
    vendor: "copilot",
    adapter: () => new CopilotHookAdapter(),
    relPath: [".copilot", "settings.json"],
    sessionId: "3d1b5f9a-0c4e-4a77-9a1f-8d2c6b0e5f11",
    cwd: "/repo/worktrees/otter",
  },
  {
    vendor: "droid",
    adapter: () => new DroidHookAdapter(),
    relPath: [".factory", "settings.json"],
    sessionId: "droid-7f3c",
    cwd: "/repo/worktrees/badger",
  },
  {
    vendor: "qodercli",
    adapter: () => new QodercliHookAdapter(),
    relPath: [".qoder", "settings.json"],
    sessionId: "qoder-91ab",
    cwd: "/repo/worktrees/heron",
  },
  {
    vendor: "devin",
    adapter: () => new DevinHookAdapter(),
    relPath: [".config", "devin", "config.json"],
    sessionId: "devin-44de",
    cwd: "/repo/worktrees/stoat",
  },
]

describe.each(ENGINES)("$vendor: installed command → dispatcher → daemon", (e) => {
  it("reports session-start for the right task, tagged with the right vendor", async () => {
    const file = join(home, ...e.relPath)
    mkdirSync(join(home, ...e.relPath.slice(0, -1)), { recursive: true })
    await e.adapter().installActivityHooks(file, { quiet: true })

    const argvs = installedHookArgv(file)
    expect(argvs).toHaveLength(1)
    // The `--engine <id>` tag is what picks the DECODING adapter. Without it
    // the dispatcher asks every adapter in turn and takes the first answer,
    // so one engine's session id gets attributed through another's reader —
    // harmless while all four read `session_id`, and not harmless the moment
    // any of them grows a detail decoder.
    expect((argvs[0] as string[]).join(" ")).toContain(`--engine ${e.vendor}`)

    stubStdin({ hook_event_name: "SessionStart", session_id: e.sessionId, cwd: e.cwd })
    await runHookSubcommand(argvs[0] as string[])

    expect(mocks.request).toHaveBeenCalledWith("engine.reportEvent", {
      cwd: e.cwd,
      kind: "session-start",
      engine: e.vendor,
      sessionId: e.sessionId,
    })
  })
})
