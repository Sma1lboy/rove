/**
 * `kobe completions <shell>` — asserts each generated script actually
 * carries every top-level subcommand AND every sub-verb in that shell's
 * grammar, plus the usage / unknown-shell error surface.
 *
 * The set-equality tests below are the anti-drift gate: they re-parse the
 * verbs back OUT of each generated script and compare them to the registries
 * the CLI itself dispatches on. A shell generator that drops, mangles or
 * hand-lists a verb goes red — and so does a verb added to one registry but
 * not carried into all three shells. Stale completions are worse than none
 * (they tell a user a verb does not exist), so this is the test that has to
 * fail before the feature can rot.
 */

import { type MockInstance, afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { API_VERBS } from "../../src/cli/api/verbs.ts"
import { runCompletionsSubcommand } from "../../src/cli/completions-cmd.ts"
import { SUBCOMMAND_VERBS, TOP_LEVEL_SUBCOMMANDS } from "../../src/cli/subcommands.ts"

/** What every generated script must offer, keyed by command. */
const EXPECTED_VERBS: Readonly<Record<string, readonly string[]>> = { ...SUBCOMMAND_VERBS, api: API_VERBS }

/**
 * Re-read the verb lists out of a generated script. Each parser is anchored
 * to that shell's emitted shape, so it yields an empty map — never a passing
 * one — if the generator stops emitting a second level at all.
 */
function parseVerbs(script: string, pattern: RegExp): Record<string, string[]> {
  const found: Record<string, string[]> = {}
  for (const m of script.matchAll(pattern)) {
    const command = m[1] as string
    found[command] = (m[2] as string)
      .split(/\s+/)
      .map((v) => v.replace(/"/g, ""))
      .filter(Boolean)
  }
  return found
}

const PARSERS: Readonly<Record<string, RegExp>> = {
  bash: /^\s+(\S+)\) COMPREPLY=\( \$\(compgen -W "([^"]*)"/gm,
  zsh: /^\s+(\S+)\) verbs=\(([^)]*)\)/gm,
  fish: /^complete -c \w+ -f -n "__fish_seen_subcommand_from (\S+)" -a "([^"]*)"/gm,
}

let stdoutSpy: MockInstance
let stderrSpy: MockInstance
let exitSpy: ReturnType<typeof vi.fn>

function stdoutText(): string {
  return stdoutSpy.mock.calls.map((c) => String(c[0])).join("")
}

beforeEach(() => {
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
  exitSpy = vi.fn(() => {
    throw new Error("exit sentinel")
  })
  vi.spyOn(process, "exit").mockImplementation(exitSpy as unknown as typeof process.exit)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("runCompletionsSubcommand", () => {
  test("bash script registers the completion fn and lists every subcommand", async () => {
    await runCompletionsSubcommand(["bash"])
    const script = stdoutText()
    expect(script).toContain("complete -F _kobe kobe")
    for (const sub of TOP_LEVEL_SUBCOMMANDS) expect(script).toContain(sub)
  })

  test("zsh script is a #compdef carrying every subcommand", async () => {
    await runCompletionsSubcommand(["zsh"])
    const script = stdoutText()
    expect(script.startsWith("#compdef kobe")).toBe(true)
    for (const sub of TOP_LEVEL_SUBCOMMANDS) expect(script).toContain(`"${sub}"`)
  })

  test("zsh script self-registers when sourced directly (not only via fpath)", async () => {
    await runCompletionsSubcommand(["zsh"])
    const script = stdoutText()
    // fpath-autoload path: the funcstack guard runs the completion fn.
    expect(script).toContain('if [ "${funcstack[1]}" = "_kobe" ]')
    // source <(...) path: falls through to an explicit compdef registration.
    expect(script).toContain("compdef _kobe kobe")
  })

  test("fish scopes the top-level list to the first word", async () => {
    await runCompletionsSubcommand(["fish"])
    const script = stdoutText()
    for (const sub of TOP_LEVEL_SUBCOMMANDS) {
      expect(script).toContain(`complete -c kobe -f -n __fish_use_subcommand -a ${sub}`)
    }
  })

  test("rove gets isolated shell registrations and install instructions", async () => {
    await runCompletionsSubcommand(["zsh"], "rove")
    const script = stdoutText()
    expect(script.startsWith("#compdef rove")).toBe(true)
    expect(script).toContain('if [ "${funcstack[1]}" = "_rove" ]')
    expect(script).toContain("compdef _rove rove")
    expect(script).not.toContain("compdef _kobe kobe")
  })

  test("--help prints usage without exiting non-zero", async () => {
    await runCompletionsSubcommand(["--help"])
    expect(stdoutText()).toContain("Usage: kobe completions")
    expect(exitSpy).not.toHaveBeenCalled()
  })

  test.each(["bash", "zsh", "fish"] as const)(
    "%s completes exactly the verbs the CLI dispatches on — no drift, no hand-copied list",
    async (shell) => {
      await runCompletionsSubcommand([shell])
      const found = parseVerbs(stdoutText(), PARSERS[shell] as RegExp)
      expect(Object.keys(found).sort()).toEqual(Object.keys(EXPECTED_VERBS).sort())
      for (const [command, verbs] of Object.entries(EXPECTED_VERBS)) {
        expect({ command, verbs: found[command] }).toEqual({ command, verbs: [...verbs] })
      }
    },
  )

  test("a command with no sub-verbs gets no second level", async () => {
    await runCompletionsSubcommand(["bash"])
    const found = parseVerbs(stdoutText(), PARSERS.bash as RegExp)
    // `doctor` takes flags, not verbs — offering it a verb list would invent one.
    expect(found.doctor).toBeUndefined()
    expect(found.export).toBeUndefined()
  })

  test("an unknown shell prints usage to stderr and exits 2", async () => {
    await expect(runCompletionsSubcommand(["powershell"])).rejects.toThrow("exit sentinel")
    expect(exitSpy).toHaveBeenCalledWith(2)
    expect(stderrSpy.mock.calls.map((c) => String(c[0])).join("")).toContain('unknown shell "powershell"')
  })

  test("a missing shell argument is the same usage error", async () => {
    await expect(runCompletionsSubcommand([])).rejects.toThrow("exit sentinel")
    expect(exitSpy).toHaveBeenCalledWith(2)
  })
})
