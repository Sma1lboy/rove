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

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
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

function stderrText(): string {
  return stderrSpy.mock.calls.map((c) => String(c[0])).join("")
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
    expect(stderrText()).toContain('unknown shell "powershell"')
  })

  test("a missing shell argument is the same usage error", async () => {
    await expect(runCompletionsSubcommand([])).rejects.toThrow("exit sentinel")
    expect(exitSpy).toHaveBeenCalledWith(2)
  })
})

/**
 * The pre-generated half: the build writes these files into the tarball, and
 * they are what a shell sources instead of paying a process start.
 */
describe("runCompletionsSubcommand with a shipped script", () => {
  let shippedDir: string
  let scriptPath: string

  beforeEach(() => {
    shippedDir = mkdtempSync(join(tmpdir(), "kobe-completions-"))
    scriptPath = join(shippedDir, "kobe.zsh")
    writeFileSync(scriptPath, "#compdef kobe\n")
  })

  test("--path prints the shipped script's path", async () => {
    await runCompletionsSubcommand(["zsh", "--path"], "kobe", { shippedDir })
    expect(stdoutText()).toBe(`${scriptPath}\n`)
  })

  test("plain stdout serves the shipped file, so --path cannot disagree with it", async () => {
    await runCompletionsSubcommand(["zsh"], "kobe", { shippedDir })
    expect(stdoutText()).toBe("#compdef kobe\n")
  })

  test("--path without a built script fails loudly rather than printing a dead path", async () => {
    const empty = mkdtempSync(join(tmpdir(), "kobe-completions-empty-"))
    await expect(runCompletionsSubcommand(["zsh", "--path"], "kobe", { shippedDir: empty })).rejects.toThrow(
      "exit sentinel",
    )
    expect(exitSpy).toHaveBeenCalledWith(2)
    expect(stderrText()).toContain(`no pre-generated zsh script at ${join(empty, "kobe.zsh")}`)
  })

  test("--install writes the shipped path into the rc file", async () => {
    const home = mkdtempSync(join(tmpdir(), "kobe-completions-home-"))
    await runCompletionsSubcommand(["zsh", "--install"], "kobe", { shippedDir, home })
    const rc = readFileSync(join(home, ".zshrc"), "utf8")
    expect(rc).toContain(`source "${scriptPath}"`)
    expect(rc).not.toContain("source <(")
    expect(stdoutText()).toContain(join(home, ".zshrc"))
  })

  test("--install without a built script still hooks the live fallback", async () => {
    const home = mkdtempSync(join(tmpdir(), "kobe-completions-home-"))
    const empty = mkdtempSync(join(tmpdir(), "kobe-completions-empty-"))
    await runCompletionsSubcommand(["zsh", "--install"], "kobe", { shippedDir: empty, home })
    expect(readFileSync(join(home, ".zshrc"), "utf8")).toContain("source <(kobe completions zsh)")
  })

  test("--install says so when the rc already holds a hand-rolled block", async () => {
    const home = mkdtempSync(join(tmpdir(), "kobe-completions-home-"))
    const rc = join(home, ".zshrc")
    writeFileSync(rc, "# mine\n# kobe completions\n_zsh_cached_completions kobe\n")
    await runCompletionsSubcommand(["zsh", "--install"], "kobe", { shippedDir, home })
    // A user's own loader is never clobbered — and the CLI must not claim otherwise.
    expect(readFileSync(rc, "utf8")).toBe("# mine\n# kobe completions\n_zsh_cached_completions kobe\n")
    expect(stdoutText()).toContain("already has a completions block")
  })

  test("--path together with --install is a usage error, not a silent pick", async () => {
    await expect(runCompletionsSubcommand(["zsh", "--path", "--install"], "kobe", { shippedDir })).rejects.toThrow(
      "exit sentinel",
    )
    expect(stderrText()).toContain("--path and --install are different things")
  })

  test("an unknown option is a usage error", async () => {
    await expect(runCompletionsSubcommand(["zsh", "--json"], "kobe", { shippedDir })).rejects.toThrow("exit sentinel")
    expect(stderrText()).toContain('unknown option "--json"')
  })
})
