import { describe, expect, it } from "vitest"
import { TOP_LEVEL_SUBCOMMANDS } from "../../src/cli/subcommands.ts"
import { topLevelUsage } from "../../src/cli/usage.ts"
import { CURRENT_VERSION } from "../../src/version.ts"

/** The command names listed under the `Commands:` block of `kobe --help`. */
function usageCommandNames(usage: string): string[] {
  const lines = usage.split("\n")
  const start = lines.indexOf("Commands:")
  const end = lines.indexOf("Options:")
  return lines
    .slice(start + 1, end)
    .map((l) => l.trim().split(/\s+/)[0])
    .filter((name) => name.length > 0)
}

describe("topLevelUsage", () => {
  const usage = topLevelUsage()

  it("renders the same command surface for the rove compatibility entry", () => {
    const roveUsage = topLevelUsage("rove")
    expect(roveUsage).toContain(`rove ${CURRENT_VERSION}`)
    expect(roveUsage).toContain("Usage: rove [command] [options]")
    expect(roveUsage).toContain("`rove api --help`")
    expect(usageCommandNames(roveUsage)).toEqual(usageCommandNames(usage))
  })

  it("keeps TOP_LEVEL_SUBCOMMANDS in lock-step with the help text (completion drift guard)", () => {
    // `kobe completions` builds its scripts from TOP_LEVEL_SUBCOMMANDS; the help
    // text is the human-facing list. If they drift, completion silently stops
    // offering (or wrongly offers) a command. Assert the two are the same set.
    const help = [...usageCommandNames(usage)].sort()
    const completions = [...TOP_LEVEL_SUBCOMMANDS].sort()
    expect(completions).toEqual(help)
  })
})
