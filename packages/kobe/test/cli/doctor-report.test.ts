import { describe, expect, it } from "vitest"
import { buildReportBundle, reportEnvLines } from "../../src/cli/doctor-report.ts"

describe("buildReportBundle", () => {
  const bundle = buildReportBundle(["kobe doctor", "  build:  v1.2.3"], {
    generatedAt: "2026-07-15T00:00:00.000Z",
    env: { KOBE_HOME_DIR: "/tmp/home", TERM: "xterm", SECRET_TOKEN: "hunter2" },
    daemonLog: "daemon line",
    ptyLog: "",
  })

  it("embeds the diagnosis lines and section headers", () => {
    expect(bundle).toContain("## diagnosis")
    expect(bundle).toContain("  build:  v1.2.3")
    expect(bundle).toContain("generated: 2026-07-15T00:00:00.000Z")
  })

  it("includes log tails, falling back when a log is empty", () => {
    expect(bundle).toContain("daemon line")
    // Header must name the real log file (<home>/.rove/pty.log, pinned by
    // paths.test.ts) so the bundle points readers at a file that exists.
    expect(bundle).toContain("## pty.log (last 200 lines)\n(empty or absent)")
  })

  it("captures ROVE_*, KOBE_* + known env keys but never arbitrary secrets", () => {
    const lines = reportEnvLines({
      ROVE_HOME_DIR: "/tmp/rove-home",
      KOBE_HOME_DIR: "/tmp/home",
      TERM: "xterm",
      SECRET_TOKEN: "hunter2",
    })
    expect(lines).toContain("ROVE_HOME_DIR=/tmp/rove-home")
    expect(lines).toContain("KOBE_HOME_DIR=/tmp/home")
    expect(lines).toContain("TERM=xterm")
    expect(lines.some((l) => l.startsWith("SECRET_TOKEN"))).toBe(false)
  })

  /**
   * The report exists to be pasted into a public bug report, and ROVE_/KOBE_
   * is the namespace the plugin env contract hands to third-party code — so an
   * unrecognized key in it is exactly where a token shows up. Presence is the
   * diagnostic signal; the value is not.
   */
  it("redacts the value of an unknown ROVE_/KOBE_ var while keeping it listed", () => {
    const lines = reportEnvLines({
      ROVE_GH_PAT: "ghp_realtokenvaluehere",
      KOBE_PLUGIN_OPENAI_KEY: "sk-live-abc123",
      ROVE_HOME_DIR: "/tmp/rove-home",
    })
    // Listed (the maintainer learns the var is set) …
    expect(lines).toContain("ROVE_GH_PAT=(set)")
    expect(lines).toContain("KOBE_PLUGIN_OPENAI_KEY=(set)")
    // … but no substring of the report carries the secret itself.
    const text = lines.join("\n")
    expect(text).not.toContain("ghp_realtokenvaluehere")
    expect(text).not.toContain("sk-live-abc123")
    // Allowlisted keys still carry their value — the report stays useful.
    expect(lines).toContain("ROVE_HOME_DIR=/tmp/rove-home")
  })

  it("distinguishes an unset allowlisted key from a redacted set one", () => {
    const lines = reportEnvLines({ ROVE_SECRET_THING: "" })
    // Empty string is still "set" — reporting it as (unset) would be a lie, and
    // an empty value can itself be the bug.
    expect(lines).toContain("ROVE_SECRET_THING=(set)")
    expect(lines).toContain("SHELL=(unset)")
  })

  it("never leaks an unknown var's value through the assembled bundle", () => {
    const text = buildReportBundle(["kobe doctor"], {
      generatedAt: "2026-07-15T00:00:00.000Z",
      env: { KOBE_ANTHROPIC_API_KEY: "sk-ant-secret" },
      daemonLog: "",
      ptyLog: "",
    })
    expect(text).toContain("KOBE_ANTHROPIC_API_KEY=(set)")
    expect(text).not.toContain("sk-ant-secret")
  })
})
